const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const paystackSecret = defineSecret('PAYSTACK_SECRET_KEY');
const MAX_SWAP_AMOUNT_NAIRA = 5000000;
const MAX_DEVICE_MEDIA = 5;
const REQUIRE_APPCHECK = process.env.REQUIRE_APPCHECK === 'true';

function requireAuthenticated(request) {
  if (!request.auth || !request.auth.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Authentication is required to use this endpoint.'
    );
  }
  if (REQUIRE_APPCHECK && !request.app) {
    throw new functions.https.HttpsError('failed-precondition', 'App verification is required.');
  }

  return request.auth.uid;
}

async function enforceRateLimit(uid, action, maxAttempts, windowMinutes = 10) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const snapshot = await db.collection('auditLogs')
    .where('uid', '==', uid)
    .where('action', '==', action)
    .where('createdAt', '>=', since)
    .limit(maxAttempts)
    .get();
  if (snapshot.size >= maxAttempts) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Please try again later.');
  }
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();

  if (['dealer', 'store', 'seller', 'partner'].includes(value)) {
    return 'dealer';
  }

  return 'customer';
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function asTrimmedString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function asPositiveAmount(value, fieldName) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_SWAP_AMOUNT_NAIRA) {
    throw new functions.https.HttpsError('invalid-argument', `${fieldName} must be a valid amount.`);
  }
  return Math.round(amount);
}

function isAllowedDocumentUrl(value) {
  return false;
}

function requireInspectionData(requestData) {
  return requestData.inspectionStatus === 'passed'
    && Boolean(requestData.inspectionReportId)
    && Boolean(requestData.technicianUid);
}

function requireVerifiedPhone(context) {
  if (!context.auth?.token?.phone_number) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'A verified phone number is required for this action.'
    );
  }
}

async function isAdminContext(context) {
  if (!context.auth) return false;
  if (context.auth.token && context.auth.token.admin === true) return true;

  // Legacy fallback is intentionally strict: both protected fields must agree.
  const snapshot = await db.collection('users').doc(context.auth.uid).get();
  return snapshot.exists
    && snapshot.data().role === 'admin'
    && snapshot.data().accountType === 'admin';
}

async function ensureUserDocument(uid, extraData = {}) {
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();

  const baseData = {
    uid,
    email: extraData.email || '',
    displayName: extraData.displayName || '',
    role: normalizeRole(extraData.role || 'customer'),
    accountType: normalizeRole(extraData.role || 'customer'),
    verificationStatus: extraData.verificationStatus || 'none',
    createdAt: snapshot.exists ? snapshot.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await userRef.set(baseData, { merge: true });
  return { uid, ...baseData };
}

exports.handleUserCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;

  await ensureUserDocument(uid, {
    email: user.email || '',
    displayName: user.displayName || '',
    role: 'customer',
    accountType: 'customer',
    verificationStatus: 'none'
  });

  await db.collection('auditLogs').add({
    uid,
    action: 'user_created',
    message: 'New Firebase Auth user created and synced to Firestore.',
    createdAt: FieldValue.serverTimestamp()
  });
});

exports.syncUserProfile = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  const payload = data || {};
  const existing = await db.collection('users').doc(uid).get();
  const role = existing.exists ? normalizeRole(existing.data().role) : 'customer';
  const profile = {
    uid,
    email: payload.email || context.auth.token.email || '',
    displayName: payload.displayName || payload.fullName || '',
    phoneNumber: payload.phoneNumber || '',
    businessName: payload.businessName || '',
    shopName: payload.shopName || '',
    updatedAt: FieldValue.serverTimestamp()
  };

  const userRef = db.collection('users').doc(uid);
  await userRef.set(profile, { merge: true });

  if (role === 'dealer') {
    const dealerRef = db.collection('dealerProfiles').doc(uid);
    await dealerRef.set({
      uid,
      storeOwnerUid: uid,
      storeName: payload.shopName || payload.businessName || 'My Store',
      contactPerson: payload.displayName || payload.fullName || '',
      businessEmail: payload.email || context.auth.token.email || '',
      phoneNumber: payload.phoneNumber || '',
      verificationStatus: 'pending',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return { ok: true, uid, role };
});

exports.submitDealerVerification = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  requireVerifiedPhone(context);
  await enforceRateLimit(uid, 'dealer_verification_submitted', 3, 60);
  const payload = data || {};
  const governmentIdData = String(payload.governmentIdData || '');
  const proofOfAddressData = String(payload.proofOfAddressData || '');
  if (!isAllowedDocumentUrl(governmentIdData) || !isAllowedDocumentUrl(proofOfAddressData)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Verification documents must be uploaded before submission.'
    );
  }

  const doc = {
    uid,
    storeName: payload.storeName || '',
    businessEmail: payload.businessEmail || '',
    phoneNumber: payload.phoneNumber || '',
    cacNumber: payload.cacNumber || '',
    governmentIdData,
    proofOfAddressData,
    status: 'pending',
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await db.collection('dealerVerification').doc(uid).set(doc, { merge: true });
  await db.collection('auditLogs').add({
    uid,
    action: 'dealer_verification_submitted',
    createdAt: FieldValue.serverTimestamp()
  });
  await db.collection('users').doc(uid).set({
    role: 'dealer',
    accountType: 'dealer',
    verificationStatus: 'pending',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, status: 'pending', uid };
});

exports.updateDealerVerificationStatus = functions.https.onCall(async (data, context) => {
  const callerUid = requireAuthenticated(context);
  const payload = data || {};
  const targetUid = payload.uid;
  const status = normalizeStatus(payload.status);

  if (!targetUid || !['pending', 'approved', 'rejected'].includes(status)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A valid target uid and status are required.'
    );
  }

  if (!(await isAdminContext(context))) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin users can update verification status.'
    );
  }

  await db.collection('dealerVerification').doc(targetUid).set({
    status,
    reviewedBy: callerUid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection('users').doc(targetUid).set({
    role: 'dealer',
    accountType: 'dealer',
    verificationStatus: status,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, uid: targetUid, status };
});

exports.createSwapRequest = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  await enforceRateLimit(uid, 'swap_request_created', 10, 10);
  const payload = data || {};

  const storeUid = asTrimmedString(payload.storeUid, 128);
  if (!payload.targetDevice || !payload.currentDevice || !storeUid) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Target device, current device, and store uid are required.'
    );
  }

  const currentDevice = typeof payload.currentDevice === 'object' ? payload.currentDevice : null;
  const targetDevice = typeof payload.targetDevice === 'object' ? payload.targetDevice : null;
  if (!currentDevice || !targetDevice) {
    throw new functions.https.HttpsError('invalid-argument', 'Device details must be objects.');
  }
  const imeiNumber = asTrimmedString(currentDevice.imeiNumber, 32);
  if (!/^[0-9A-Za-z-]{8,32}$/.test(imeiNumber)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid device IMEI or serial number is required.');
  }
  const duplicateImei = await db.collection('swapRequests')
    .where('currentDevice.imeiNumber', '==', imeiNumber)
    .where('status', 'in', ['pending', 'reviewed', 'countered', 'accepted', 'under_inspection'])
    .limit(1)
    .get();
  if (!duplicateImei.empty) {
    throw new functions.https.HttpsError('already-exists', 'This device is already part of an active swap.');
  }
  const topupAmount = asPositiveAmount(payload.topupAmount || 0, 'topupAmount');
  const offeredPrice = asPositiveAmount(payload.offeredPrice || 0, 'offeredPrice');

  const requestDoc = {
    customerUid: uid,
    dealerUid: storeUid,
    status: 'pending',
    currentDevice: { ...currentDevice, imeiNumber },
    targetDevice,
    offeredPrice,
    topupAmount,
    message: asTrimmedString(payload.message),
    deviceMedia: Array.isArray(payload.deviceMedia) ? payload.deviceMedia.slice(0, MAX_DEVICE_MEDIA) : [],
    disputeStatus: 'none',
    paymentStatus: topupAmount > 0 ? 'unpaid' : 'not_required',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection('swapRequests').add(requestDoc);

  await db.collection('auditLogs').add({
    uid,
    action: 'swap_request_created',
    requestId: ref.id,
    message: 'New swap request created by customer.',
    createdAt: FieldValue.serverTimestamp()
  });

  return { ok: true, requestId: ref.id, status: 'pending' };
});

exports.createListing = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  const verification = await db.collection('dealerVerification').doc(uid).get();
  if (!verification.exists || verification.data().status !== 'approved') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Dealer verification must be approved before publishing listings.'
    );
  }

  const payload = data || {};
  const model = String(payload.model || '').trim();
  const brand = String(payload.brand || '').trim();
  const marketValue = Number(payload.marketValue || 0);
  if (!model || !['Apple', 'Samsung'].includes(brand) || !Number.isFinite(marketValue) || marketValue <= 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A valid Apple or Samsung listing with a positive price is required.'
    );
  }

  const listing = {
    storeOwnerUid: uid,
    storeId: String(payload.storeId || uid),
    storeName: String(payload.storeName || ''),
    brand,
    model,
    storage: String(payload.storage || ''),
    condition: String(payload.condition || ''),
    conditionGrade: String(payload.conditionGrade || ''),
    color: String(payload.color || ''),
    battery: String(payload.battery || ''),
    marketValue,
    quantityInStock: Math.max(0, Number(payload.quantityInStock || 0)),
    isSwapAllowed: payload.isSwapAllowed !== false,
    image: String(payload.image || ''),
    mediaFiles: Array.isArray(payload.mediaFiles) ? payload.mediaFiles.slice(0, 5) : [],
    description: String(payload.description || ''),
    location: String(payload.location || ''),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection('listings').add(listing);
  return { ok: true, listingId: ref.id, listing: { ...listing, id: ref.id } };
});

exports.recordSwapInspection = functions.https.onCall(async (data, context) => {
  const technicianUid = requireAuthenticated(context);
  if (!(await isAdminContext(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Only an authorized technician or admin can record inspections.');
  }
  const requestId = asTrimmedString(data?.requestId, 128);
  const passed = data?.passed === true;
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'A swap request ID is required.');
  }
  const requestRef = db.collection('swapRequests').doc(requestId);
  const snapshot = await requestRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Swap request not found.');
  }
  await requestRef.set({
    inspectionStatus: passed ? 'passed' : 'failed',
    inspectionReportId: asTrimmedString(data?.inspectionReportId, 128),
    technicianUid,
    inspectionNotes: asTrimmedString(data?.notes, 2000),
    inspectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, requestId, inspectionStatus: passed ? 'passed' : 'failed' };
});

exports.confirmSwapHandover = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  const requestId = asTrimmedString(data?.requestId, 128);
  if (!requestId || data?.confirmed !== true) {
    throw new functions.https.HttpsError('invalid-argument', 'A request ID and explicit confirmation are required.');
  }
  const requestRef = db.collection('swapRequests').doc(requestId);
  const snapshot = await requestRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Swap request not found.');
  }
  const requestData = snapshot.data();
  if (requestData.customerUid !== uid && requestData.dealerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'You are not a participant in this swap.');
  }
  const update = uid === requestData.customerUid
    ? { customerConfirmed: true }
    : { dealerConfirmed: true };
  await requestRef.set({ ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, requestId };
});

exports.openSwapDispute = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  const requestId = asTrimmedString(data?.requestId, 128);
  const reason = asTrimmedString(data?.reason, 2000);
  if (!requestId || !reason) {
    throw new functions.https.HttpsError('invalid-argument', 'A request ID and dispute reason are required.');
  }
  const requestRef = db.collection('swapRequests').doc(requestId);
  const snapshot = await requestRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Swap request not found.');
  }
  const requestData = snapshot.data();
  if (requestData.customerUid !== uid && requestData.dealerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'You are not a participant in this swap.');
  }
  if (requestData.status === 'cancelled' || requestData.status === 'rejected') {
    throw new functions.https.HttpsError('failed-precondition', 'This swap cannot be disputed.');
  }
  await requestRef.set({
    disputeStatus: 'open',
    disputeOpenedBy: uid,
    disputeReason: reason,
    disputeOpenedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('auditLogs').add({
    uid,
    action: 'swap_dispute_opened',
    requestId,
    message: 'Swap dispute opened and transaction flagged for review.',
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, requestId, disputeStatus: 'open' };
});

exports.updateSwapRequestStatus = functions.https.onCall(async (data, context) => {
  const uid = requireAuthenticated(context);
  const payload = data || {};
  const requestId = payload.requestId;
  const status = normalizeStatus(payload.status);

  if (!requestId || !status) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'requestId and status are required.'
    );
  }

  const allowedStatuses = ['pending', 'reviewed', 'accepted', 'countered', 'under_inspection', 'inspection_passed', 'completed', 'rejected', 'cancelled'];
  if (!allowedStatuses.includes(status)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Unsupported swap status.'
    );
  }

  const requestRef = db.collection('swapRequests').doc(requestId);
  const requestSnapshot = await requestRef.get();

  if (!requestSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Swap request not found.');
  }

  const requestData = requestSnapshot.data();
  const isCustomer = requestData.customerUid === uid;
  const isDealer = requestData.dealerUid === uid;
  const isAdmin = await isAdminContext(context);

  if (!isCustomer && !isDealer && !isAdmin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You do not have permission to update this swap request.'
    );
  }

  const previousStatus = normalizeStatus(requestData.status || 'pending');
  const transitions = {
    pending: ['reviewed', 'rejected', 'cancelled'],
    reviewed: ['accepted', 'countered', 'rejected', 'cancelled'],
    countered: ['accepted', 'countered', 'rejected', 'cancelled'],
    accepted: ['under_inspection', 'cancelled'],
    under_inspection: ['inspection_passed', 'cancelled'],
    inspection_passed: ['completed', 'cancelled'],
    completed: ['completed'],
    rejected: ['rejected'],
    cancelled: ['cancelled']
  };
  if (!transitions[previousStatus] || !transitions[previousStatus].includes(status)) {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid swap status transition.');
  }

  if (status === 'completed') {
    if (!requestData.customerConfirmed || !requestData.dealerConfirmed || !requireInspectionData(requestData)) {
      throw new functions.https.HttpsError('failed-precondition', 'Both parties and the inspection technician must confirm the handover.');
    }
    if (requestData.paymentStatus === 'unpaid') {
      throw new functions.https.HttpsError('failed-precondition', 'Top-up payment must be verified before completion.');
    }

    try {
      const listingId = requestData.targetDevice?.listingId || requestData.targetDevice?.id;
      let listingRef = null;
      if (listingId) {
        const docRef = db.collection('listings').doc(listingId);
        const check = await docRef.get();
        if (check.exists) listingRef = docRef;
      }
      if (!listingRef && requestData.dealerUid && requestData.targetDevice?.model) {
        const matchSnap = await db.collection('listings')
          .where('storeOwnerUid', '==', requestData.dealerUid)
          .where('model', '==', requestData.targetDevice.model)
          .limit(1).get();
        if (!matchSnap.empty) listingRef = matchSnap.docs[0].ref;
      }
      if (listingRef) {
        const lSnap = await listingRef.get();
        const curQty = Math.max(0, Number(lSnap.data().quantityInStock || 1));
        const newQty = Math.max(0, curQty - 1);
        await listingRef.set({
          quantityInStock: newQty,
          status: newQty === 0 ? 'out_of_stock' : 'active',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (e) {
      console.warn('[Functions] Stock decrement error:', e.message);
    }
  }

  await requestRef.set({
    status,
    counterOffer: payload.counterOffer ? asPositiveAmount(payload.counterOffer, 'counterOffer') : null,
    counterMessage: asTrimmedString(payload.counterMessage),
    updatedAt: FieldValue.serverTimestamp(),
    lastUpdatedBy: uid
  }, { merge: true });

  const recipientUid = uid === requestData.customerUid
    ? requestData.dealerUid
    : requestData.customerUid;
  if (recipientUid) {
    await db.collection('users').doc(recipientUid).collection('notifications').add({
      type: `swap_${status}`,
      requestId,
      status,
      title: status === 'countered' ? 'New counter-offer received' : `Swap request ${status}`,
      message: status === 'countered'
        ? (payload.counterMessage || 'The other party sent a revised swap offer.')
        : `Your swap request has been marked ${status}.`,
      isRead: false,
      createdAt: FieldValue.serverTimestamp()
    });

    /* Legacy nested payment handlers removed; use the exported handlers below.
    const initializePaystackPayment = functions.https.onCall(async (data, context) => {
      const uid = requireAuthenticated(context);
      if (!PAYSTACK_SECRET_KEY) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Paystack is not configured on the server.'
        );
      }

      const amountKobo = Math.round(Number(data?.amountNaira || 0) * 100);
      const email = String(data?.email || context.auth.token.email || '').trim();
      const requestId = String(data?.requestId || '').trim();
      if (!email || !Number.isFinite(amountKobo) || amountKobo <= 0 || !requestId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'A valid email, positive amount, and swap request ID are required.'
        );
      }

      const requestSnapshot = await db.collection('swapRequests').doc(requestId).get();
      if (!requestSnapshot.exists || requestSnapshot.data().customerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'You cannot pay for this swap request.');
      }

      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          amount: amountKobo,
          reference: `naijaswap_${requestId}_${Date.now()}`,
          metadata: { uid, requestId }
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload.status || !payload.data?.authorization_url) {
        throw new functions.https.HttpsError('internal', 'Paystack could not initialize the payment.');
      }

      await db.collection('swapRequests').doc(requestId).set({
        paymentStatus: 'initialized',
        paymentReference: payload.data.reference,
        paymentAmountKobo: amountKobo,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return {
        authorizationUrl: payload.data.authorization_url,
        accessCode: payload.data.access_code,
        reference: payload.data.reference
      };
    });

    const verifyPaystackPayment = functions.https.onCall(async (data, context) => {
      const uid = requireAuthenticated(context);
      if (!PAYSTACK_SECRET_KEY) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Paystack is not configured on the server.'
        );
      }

      const reference = String(data?.reference || '').trim();
      if (!reference) {
        throw new functions.https.HttpsError('invalid-argument', 'A payment reference is required.');
      }

      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
      });
      const payload = await response.json();
      const transaction = payload.data;
      if (!response.ok || !payload.status || transaction?.status !== 'success') {
        throw new functions.https.HttpsError('failed-precondition', 'Paystack payment has not been verified.');
      }

      const requestId = String(transaction.metadata?.requestId || '').trim();
      if (!requestId) {
        throw new functions.https.HttpsError('invalid-argument', 'Payment is not linked to a swap request.');
      }
      const requestRef = db.collection('swapRequests').doc(requestId);
      const requestSnapshot = await requestRef.get();
      if (!requestSnapshot.exists || requestSnapshot.data().customerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'You cannot verify this payment.');
      }

      await requestRef.set({
        paymentStatus: 'paid',
        paymentReference: reference,
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return { ok: true, requestId, reference, status: 'paid' };
    });
    */
  }

  await db.collection('auditLogs').add({
    uid,
    action: 'swap_request_status_updated',
    requestId,
    status,
    message: `Swap request marked as ${status}.`,
    createdAt: FieldValue.serverTimestamp()
  });

  return { ok: true, requestId, status };
});

exports.initializePaystackPayment = functions.https.onCall({ secrets: [paystackSecret] }, async (data, context) => {
  const uid = requireAuthenticated(context);
  await enforceRateLimit(uid, 'payment_initialized', 5, 10);
  const paystackSecretKey = paystackSecret.value();
  if (!paystackSecretKey) {
    throw new functions.https.HttpsError('failed-precondition', 'Paystack is not configured on the server.');
  }

  const amountKobo = Math.round(Number(data?.amountNaira || 0) * 100);
  const email = String(data?.email || context.auth.token.email || '').trim();
  const requestId = String(data?.requestId || '').trim();
  if (!email || amountKobo <= 0 || amountKobo > MAX_SWAP_AMOUNT_NAIRA * 100 || !requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid email, amount, and request ID are required.');
  }

  const requestSnapshot = await db.collection('swapRequests').doc(requestId).get();
  if (!requestSnapshot.exists || requestSnapshot.data().customerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'You cannot pay for this swap request.');
  }
  const requestData = requestSnapshot.data();
  const expectedAmountKobo = asPositiveAmount(requestData.topupAmount || 0, 'topupAmount') * 100;
  if (expectedAmountKobo <= 0 || amountKobo !== expectedAmountKobo) {
    throw new functions.https.HttpsError('failed-precondition', 'Payment amount does not match the approved swap top-up.');
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + paystackSecretKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      reference: `naijaswap_${requestId}_${Date.now()}`,
      metadata: { uid, requestId }
    })
  });
  const result = await response.json();
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    throw new functions.https.HttpsError('internal', 'Paystack could not initialize the payment.');
  }

  await db.collection('swapRequests').doc(requestId).set({
    paymentStatus: 'initialized',
    paymentReference: result.data.reference,
    paymentAmountKobo: amountKobo,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('auditLogs').add({
    uid,
    action: 'payment_initialized',
    requestId,
    createdAt: FieldValue.serverTimestamp()
  });

  return {
    authorizationUrl: result.data.authorization_url,
    accessCode: result.data.access_code,
    reference: result.data.reference
  };
});

exports.verifyPaystackPayment = functions.https.onCall({ secrets: [paystackSecret] }, async (data, context) => {
  const uid = requireAuthenticated(context);
  const paystackSecretKey = paystackSecret.value();
  if (!paystackSecretKey) {
    throw new functions.https.HttpsError('failed-precondition', 'Paystack is not configured on the server.');
  }

  const reference = String(data?.reference || '').trim();
  if (!reference) {
    throw new functions.https.HttpsError('invalid-argument', 'A payment reference is required.');
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: 'Bearer ' + paystackSecretKey } }
  );
  const result = await response.json();
  const transaction = result.data;
  if (!response.ok || !result.status || transaction?.status !== 'success') {
    throw new functions.https.HttpsError('failed-precondition', 'Paystack payment has not been verified.');
  }

  const requestId = String(transaction.metadata?.requestId || '').trim();
  const requestRef = db.collection('swapRequests').doc(requestId);
  const requestSnapshot = await requestRef.get();
  if (!requestId || !requestSnapshot.exists || requestSnapshot.data().customerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'You cannot verify this payment.');
  }
  const requestData = requestSnapshot.data();
  const expectedAmountKobo = asPositiveAmount(requestData.topupAmount || 0, 'topupAmount') * 100;
  if (transaction.currency !== 'NGN' || Number(transaction.amount) !== expectedAmountKobo) {
    throw new functions.https.HttpsError('failed-precondition', 'Verified payment amount does not match the swap top-up.');
  }
  if (requestData.paymentStatus === 'paid' && requestData.paymentReference === reference) {
    return { ok: true, requestId, reference, status: 'paid' };
  }

  await requestRef.set({
    paymentStatus: 'paid',
    paymentReference: reference,
    paidAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, requestId, reference, status: 'paid' };
});

exports.logSwapActivity = functions.firestore.document('swapRequests/{requestId}').onUpdate(async (change, context) => {
  const before = change.before.data() || {};
  const after = change.after.data() || {};

  if (before.status === after.status) {
    return null;
  }

  await db.collection('auditLogs').add({
    uid: after.lastUpdatedBy || 'system',
    action: 'swap_status_changed',
    requestId: context.params.requestId,
    previousStatus: before.status || 'unknown',
    newStatus: after.status || 'unknown',
    createdAt: FieldValue.serverTimestamp()
  });

  return null;
});
