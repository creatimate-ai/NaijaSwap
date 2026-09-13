const express = require('express');
const crypto = require('crypto');
const { v2: cloudinary } = require('cloudinary');
const admin = require('firebase-admin');

const router = express.Router();
const MAX_SWAP_AMOUNT_NAIRA = 5000000;

function getFirebaseAdmin() {
  if (admin.apps.length) return admin;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured on the Render service.');
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      ...serviceAccount,
      private_key: serviceAccount.private_key.replace(/\\n/g, '\n')
    })
  });
  return admin;
}

function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary server credentials are not configured.');
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });
  return cloudinary;
}

async function authenticate(request, response, next) {
  const header = request.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return response.status(401).json({ error: 'Authentication is required.' });
  try {
    const firebase = getFirebaseAdmin();
    request.user = await firebase.auth().verifyIdToken(token);
    return next();
  } catch (error) {
    console.error('[API] Authentication failed:', error.message);
    return response.status(401).json({ error: 'Invalid authentication token.' });
  }
}

function requireString(value, field, maxLength = 500) {
  const result = String(value || '').trim();
  if (!result || result.length > maxLength) {
    const error = new Error(`${field} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function validateCloudinaryAsset(value, uid) {
  return typeof value === 'string'
    && value.startsWith(`naijaswap/${uid}/`)
    && value.length < 300;
}

function validateAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_SWAP_AMOUNT_NAIRA) {
    const error = new Error('Invalid amount.');
    error.statusCode = 400;
    throw error;
  }
  return Math.round(amount);
}

router.get('/health', (request, response) => {
  response.json({
    ok: true,
    service: 'naijaswap-api',
    cloudinaryConfigured: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    firebaseConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY)
  });
});

router.post('/api/cloudinary/sign-upload', authenticate, (request, response) => {
  try {
    const kind = requireString(request.body.kind, 'kind', 40).replace(/[^a-z0-9_-]/gi, '');
    if (!['government_id', 'proof_of_address', 'device_media', 'listing_media'].includes(kind)) {
      return response.status(400).json({ error: 'Unsupported upload type.' });
    }
    const cloud = configureCloudinary();
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `naijaswap/${request.user.uid}/${kind}_${crypto.randomUUID()}`;
    const params = {
      folder: `naijaswap/${request.user.uid}`,
      public_id: publicId,
      timestamp,
      type: 'authenticated'
    };
    const signature = cloud.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
    return response.json({
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
      apiKey: process.env.CLOUDINARY_API_KEY,
      ...params,
      signature
    });
  } catch (error) {
    console.error('[API] Cloudinary signing failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

router.post('/api/dealer-verification', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const governmentIdUrl = requireString(request.body.governmentIdData, 'governmentIdData', 300);
    const proofOfAddressUrl = requireString(request.body.proofOfAddressData, 'proofOfAddressData', 300);
    if (!validateCloudinaryAsset(governmentIdUrl, uid) || !validateCloudinaryAsset(proofOfAddressUrl, uid)) {
      return response.status(400).json({ error: 'Verification documents must be private Cloudinary assets.' });
    }
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    await db.collection('dealerVerification').doc(uid).set({
      uid,
      storeName: String(request.body.storeName || '').trim(),
      businessEmail: String(request.body.businessEmail || '').trim(),
      phoneNumber: String(request.body.phoneNumber || '').trim(),
      cacNumber: String(request.body.cacNumber || '').trim(),
      governmentIdData: governmentIdUrl,
      proofOfAddressData: proofOfAddressUrl,
      status: 'pending',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('users').doc(uid).set({
      role: 'dealer',
      accountType: 'dealer',
      verificationStatus: 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({ ok: true, uid, status: 'pending' });
  } catch (error) {
    console.error('[API] Dealer verification failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

router.post('/api/payments/initialize', authenticate, async (request, response) => {
  try {
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const email = requireString(request.body.email || request.user.email, 'email', 320);
    const amountNaira = validateAmount(request.body.amountNaira);
    if (amountNaira <= 0) return response.status(400).json({ error: 'Amount must be positive.' });
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const swap = await db.collection('swapRequests').doc(requestId).get();
    if (!swap.exists || swap.data().customerUid !== request.user.uid) {
      return response.status(403).json({ error: 'You cannot pay for this swap.' });
    }
    const expected = validateAmount(swap.data().topupAmount) * 100;
    if (amountNaira * 100 !== expected) {
      return response.status(409).json({ error: 'Payment amount does not match the approved top-up.' });
    }
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireString(process.env.PAYSTACK_SECRET_KEY, 'PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: expected,
        reference: `naijaswap_${requestId}_${Date.now()}`,
        metadata: { uid: request.user.uid, requestId }
      })
    });
    const result = await paystackResponse.json();
    if (!paystackResponse.ok || !result.status || !result.data?.authorization_url) {
      return response.status(502).json({ error: 'Paystack could not initialize the payment.' });
    }
    await swap.ref.set({
      paymentStatus: 'initialized',
      paymentReference: result.data.reference,
      paymentAmountKobo: expected,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({
      authorizationUrl: result.data.authorization_url,
      accessCode: result.data.access_code,
      reference: result.data.reference
    });
  } catch (error) {
    console.error('[API] Payment initialization failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

router.post('/api/payments/verify', authenticate, async (request, response) => {
  try {
    const reference = requireString(request.body.reference, 'reference', 200);
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${requireString(process.env.PAYSTACK_SECRET_KEY, 'PAYSTACK_SECRET_KEY')}` }
    });
    const result = await paystackResponse.json();
    const transaction = result.data;
    if (!paystackResponse.ok || !result.status || transaction?.status !== 'success') {
      return response.status(409).json({ error: 'Payment has not been verified.' });
    }
    const requestId = requireString(transaction.metadata?.requestId, 'requestId', 128);
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const swapRef = db.collection('swapRequests').doc(requestId);
    const swap = await swapRef.get();
    if (!swap.exists || swap.data().customerUid !== request.user.uid) {
      return response.status(403).json({ error: 'You cannot verify this payment.' });
    }
    const expected = validateAmount(swap.data().topupAmount) * 100;
    if (transaction.currency !== 'NGN' || Number(transaction.amount) !== expected) {
      return response.status(409).json({ error: 'Payment amount does not match the approved top-up.' });
    }
    await swapRef.set({
      paymentStatus: 'paid',
      paymentReference: reference,
      paidAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({ ok: true, requestId, reference, status: 'paid' });
  } catch (error) {
    console.error('[API] Payment verification failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// Helper: write a notification to a user
async function sendNotification(db, recipientUid, notification) {
  try {
    await db.collection('users').doc(recipientUid).collection('notifications').add({
      ...notification,
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('[API] Could not send notification:', e.message);
  }
}

// Helper: validate swap status transition
function isValidTransition(from, to) {
  const transitions = {
    pending: ['reviewed', 'rejected', 'cancelled'],
    reviewed: ['accepted', 'countered', 'rejected', 'cancelled'],
    countered: ['accepted', 'countered', 'rejected', 'cancelled'],
    accepted: ['under_inspection', 'cancelled'],
    under_inspection: ['inspection_passed', 'cancelled'],
    inspection_passed: ['completed', 'cancelled'],
    completed: [],
    rejected: [],
    cancelled: []
  };
  return (transitions[from] || []).includes(to);
}

// POST /api/swap/create
router.post('/api/swap/create', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const payload = request.body || {};
    const storeUid = requireString(payload.storeUid, 'storeUid', 128);
    const currentDevice = typeof payload.currentDevice === 'object' && payload.currentDevice ? payload.currentDevice : null;
    const targetDevice = typeof payload.targetDevice === 'object' && payload.targetDevice ? payload.targetDevice : null;
    if (!currentDevice || !targetDevice) {
      return response.status(400).json({ error: 'Device details must be objects.' });
    }
    const imeiNumber = String(currentDevice.imeiNumber || '').trim().slice(0, 32);
    if (!/^[0-9A-Za-z-]{8,32}$/.test(imeiNumber)) {
      return response.status(400).json({ error: 'A valid device IMEI or serial number is required.' });
    }
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    // Check IMEI uniqueness
    const dupe = await db.collection('swapRequests')
      .where('currentDevice.imeiNumber', '==', imeiNumber)
      .where('status', 'in', ['pending', 'reviewed', 'countered', 'accepted', 'under_inspection'])
      .limit(1).get();
    if (!dupe.empty) {
      return response.status(409).json({ error: 'This device is already part of an active swap.' });
    }
    const topupAmount = validateAmount(payload.topupAmount || 0);
    const offeredPrice = validateAmount(payload.offeredPrice || 0);
    const doc = {
      customerUid: uid,
      dealerUid: storeUid,
      status: 'pending',
      currentDevice: { ...currentDevice, imeiNumber },
      targetDevice,
      offeredPrice,
      topupAmount,
      message: String(payload.message || '').trim().slice(0, 500),
      deviceMedia: Array.isArray(payload.deviceMedia) ? payload.deviceMedia.slice(0, 5) : [],
      disputeStatus: 'none',
      paymentStatus: topupAmount > 0 ? 'unpaid' : 'not_required',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('swapRequests').add(doc);
    await sendNotification(db, storeUid, {
      type: 'swap_pending',
      requestId: ref.id,
      status: 'pending',
      title: 'New Swap Request',
      message: `A customer submitted a new swap request for ${targetDevice.model || 'a phone'}.`
    });
    await db.collection('auditLogs').add({
      uid, action: 'swap_request_created', requestId: ref.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return response.json({ ok: true, requestId: ref.id, status: 'pending' });
  } catch (error) {
    console.error('[API] Swap create failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/swap/status
router.post('/api/swap/status', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const status = String(request.body.status || '').trim().toLowerCase();
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const requestRef = db.collection('swapRequests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap request not found.' });
    const data = snap.data();
    const isCustomer = data.customerUid === uid;
    const isDealer = data.dealerUid === uid;
    // Check admin via Firestore
    let isAdminUser = request.user.admin === true;
    if (!isAdminUser) {
      const userSnap = await db.collection('users').doc(uid).get();
      isAdminUser = userSnap.exists && userSnap.data().role === 'admin' && userSnap.data().accountType === 'admin';
    }
    if (!isCustomer && !isDealer && !isAdminUser) {
      return response.status(403).json({ error: 'You do not have permission to update this swap.' });
    }
    const prevStatus = String(data.status || 'pending').toLowerCase();
    if (!isValidTransition(prevStatus, status)) {
      return response.status(409).json({ error: `Cannot transition from '${prevStatus}' to '${status}'.` });
    }
    if (status === 'completed') {
      if (!data.customerConfirmed || !data.dealerConfirmed) {
        return response.status(409).json({ error: 'Both parties must confirm handover before completion.' });
      }
      if (data.inspectionStatus !== 'passed') {
        return response.status(409).json({ error: 'Inspection must be passed before completion.' });
      }
      if (data.paymentStatus === 'unpaid') {
        return response.status(409).json({ error: 'Top-up payment must be verified before completion.' });
      }

      // Decrement listing stock & mark out_of_stock if exhausted
      try {
        const listingId = data.targetDevice?.listingId || data.targetDevice?.id;
        let listingRef = null;
        if (listingId) {
          const docRef = db.collection('listings').doc(listingId);
          const snapCheck = await docRef.get();
          if (snapCheck.exists) listingRef = docRef;
        }
        if (!listingRef && data.dealerUid && data.targetDevice?.model) {
          const matchSnap = await db.collection('listings')
            .where('storeOwnerUid', '==', data.dealerUid)
            .where('model', '==', data.targetDevice.model)
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
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (stockErr) {
        console.warn('[API] Listing stock decrement warning:', stockErr.message);
      }
    }
    const update = {
      status,
      lastUpdatedBy: uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (request.body.counterOffer) update.counterOffer = validateAmount(request.body.counterOffer);
    if (request.body.counterMessage) update.counterMessage = String(request.body.counterMessage).trim().slice(0, 500);
    await requestRef.set(update, { merge: true });
    const recipientUid = uid === data.customerUid ? data.dealerUid : data.customerUid;
    if (recipientUid) {
      const title = status === 'countered' ? 'Counter-offer received' : `Swap ${status}`;
      const message = status === 'countered'
        ? (request.body.counterMessage || 'A revised swap offer was sent.')
        : `Your swap has been marked ${status}.`;
      await sendNotification(db, recipientUid, { type: `swap_${status}`, requestId, status, title, message });
    }
    await db.collection('auditLogs').add({
      uid, action: 'swap_status_updated', requestId, status,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return response.json({ ok: true, requestId, status });
  } catch (error) {
    console.error('[API] Swap status update failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/swap/confirm-handover
router.post('/api/swap/confirm-handover', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    if (request.body.confirmed !== true) {
      return response.status(400).json({ error: 'Explicit confirmation required.' });
    }
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const requestRef = db.collection('swapRequests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap request not found.' });
    const data = snap.data();
    if (data.customerUid !== uid && data.dealerUid !== uid) {
      return response.status(403).json({ error: 'You are not a participant in this swap.' });
    }
    const update = uid === data.customerUid
      ? { customerConfirmed: true }
      : { dealerConfirmed: true };
    update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await requestRef.set(update, { merge: true });
    const recipientUid = uid === data.customerUid ? data.dealerUid : data.customerUid;
    if (recipientUid) {
      await sendNotification(db, recipientUid, {
        type: 'handover_confirmed',
        requestId,
        title: 'Handover Confirmed',
        message: `The ${uid === data.customerUid ? 'customer' : 'store'} has confirmed handover for swap request.`
      });
    }
    return response.json({ ok: true, requestId });
  } catch (error) {
    console.error('[API] Handover confirmation failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/swap/dispute
router.post('/api/swap/dispute', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const reason = requireString(request.body.reason, 'reason', 2000);
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const requestRef = db.collection('swapRequests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap request not found.' });
    const data = snap.data();
    if (data.customerUid !== uid && data.dealerUid !== uid) {
      return response.status(403).json({ error: 'You are not a participant in this swap.' });
    }
    if (['cancelled', 'rejected'].includes(data.status)) {
      return response.status(409).json({ error: 'This swap cannot be disputed.' });
    }
    await requestRef.set({
      disputeStatus: 'open',
      disputeOpenedBy: uid,
      disputeReason: reason,
      disputeOpenedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const recipientUid = uid === data.customerUid ? data.dealerUid : data.customerUid;
    if (recipientUid) {
      await sendNotification(db, recipientUid, {
        type: 'swap_dispute',
        requestId,
        title: 'Dispute Opened',
        message: 'A dispute has been opened on your swap request. Our team will review it.'
      });
    }
    await db.collection('auditLogs').add({
      uid, action: 'swap_dispute_opened', requestId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return response.json({ ok: true, requestId, disputeStatus: 'open' });
  } catch (error) {
    console.error('[API] Dispute open failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/swap/inspection  (admin or hub technician)
router.post('/api/swap/inspection', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    // Verify admin or technician
    let isAuthorized = request.user.admin === true || request.user.role === 'technician' || request.user.role === 'admin';
    if (!isAuthorized) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        const role = userSnap.data().role;
        const accountType = userSnap.data().accountType;
        isAuthorized = (role === 'admin' && accountType === 'admin') || role === 'technician' || accountType === 'technician' || userSnap.data().isTechnician === true;
      }
    }
    if (!isAuthorized) return response.status(403).json({ error: 'Only authorized technicians or admins can record inspections.' });
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const passed = request.body.passed === true;
    const requestRef = db.collection('swapRequests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap request not found.' });
    const data = snap.data();
    
    // Auto-generate certified report ID if not provided
    const reportId = String(request.body.inspectionReportId || ('NS-CERT-' + crypto.randomBytes(3).toString('hex').toUpperCase())).trim().slice(0, 128);
    const diagnostics = typeof request.body.diagnostics === 'object' && request.body.diagnostics ? request.body.diagnostics : {};
    
    const inspectionUpdate = {
      inspectionStatus: passed ? 'passed' : 'failed',
      inspectionReportId: reportId,
      technicianUid: uid,
      technicianName: String(request.body.technicianName || request.user.name || 'Hub Technician').slice(0, 100),
      hubLocation: String(request.body.hubLocation || 'Computer Village Hub, Ikeja').slice(0, 120),
      inspectionNotes: String(request.body.notes || '').trim().slice(0, 2000),
      diagnosticDetails: {
        screenPassed: diagnostics.screenPassed !== false,
        batteryHealth: Math.min(100, Math.max(50, Number(diagnostics.batteryHealth || 92))),
        icloudSignedOut: diagnostics.icloudSignedOut !== false,
        camerasPassed: diagnostics.camerasPassed !== false,
        biometricsPassed: diagnostics.biometricsPassed !== false,
        imeiClean: diagnostics.imeiClean !== false,
        physicalGrade: String(diagnostics.physicalGrade || 'Grade A')
      },
      inspectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // If passed and swap is currently accepted or under_inspection, transition to inspection_passed
    const currentStatus = String(data.status || '').toLowerCase();
    if (passed && ['accepted', 'under_inspection'].includes(currentStatus)) {
      inspectionUpdate.status = 'inspection_passed';
    }

    await requestRef.set(inspectionUpdate, { merge: true });

    // Notify both parties
    for (const recipientUid of [data.customerUid, data.dealerUid].filter(Boolean)) {
      await sendNotification(db, recipientUid, {
        type: passed ? 'inspection_passed' : 'inspection_failed',
        requestId,
        reportId,
        title: passed ? '✓ Inspection Passed & Certified' : 'Inspection Failed',
        message: passed 
          ? `Device passed all diagnostic checks. Digital certificate #${reportId} issued. You can proceed with handover.` 
          : 'Device did not pass physical inspection. Please review technician notes or contact support.'
      });
    }
    return response.json({ ok: true, requestId, inspectionStatus: passed ? 'passed' : 'failed', inspectionReportId: reportId });
  } catch (error) {
    console.error('[API] Inspection record failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/listing/create
const ALLOWED_BRANDS = ['Apple', 'Samsung'];
router.post('/api/listing/create', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const verification = await db.collection('dealerVerification').doc(uid).get();
    if (!verification.exists || verification.data().status !== 'approved') {
      return response.status(403).json({ error: 'Dealer verification must be approved before creating listings.' });
    }
    const brand = String(request.body.brand || '').trim();
    const model = String(request.body.model || '').trim();
    const marketValue = Number(request.body.marketValue || 0);
    if (!model || !ALLOWED_BRANDS.includes(brand) || !Number.isFinite(marketValue) || marketValue <= 0) {
      return response.status(400).json({ error: 'A valid brand, model name, and positive price are required.' });
    }
    const listing = {
      storeOwnerUid: uid,
      storeId: String(request.body.storeId || uid),
      storeName: String(request.body.storeName || ''),
      brand, model,
      storage: String(request.body.storage || ''),
      condition: String(request.body.condition || ''),
      conditionGrade: String(request.body.conditionGrade || ''),
      color: String(request.body.color || ''),
      battery: String(request.body.battery || ''),
      marketValue,
      quantityInStock: Math.max(0, Number(request.body.quantityInStock || 0)),
      isSwapAllowed: request.body.isSwapAllowed !== false,
      image: String(request.body.image || ''),
      mediaFiles: Array.isArray(request.body.mediaFiles) ? request.body.mediaFiles.slice(0, 5) : [],
      description: String(request.body.description || '').trim().slice(0, 2000),
      location: String(request.body.location || '').trim().slice(0, 200),
      status: 'active',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('listings').add(listing);
    return response.json({ ok: true, listingId: ref.id, listing: { ...listing, id: ref.id } });
  } catch (error) {
    console.error('[API] Listing create failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/admin/verification-status  (admin only)
router.post('/api/admin/verification-status', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    let isAdminUser = request.user.admin === true;
    if (!isAdminUser) {
      const userSnap = await db.collection('users').doc(uid).get();
      isAdminUser = userSnap.exists && userSnap.data().role === 'admin' && userSnap.data().accountType === 'admin';
    }
    if (!isAdminUser) return response.status(403).json({ error: 'Admin access required.' });
    const targetUid = requireString(request.body.uid, 'uid', 128);
    const status = String(request.body.status || '').trim().toLowerCase();
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return response.status(400).json({ error: 'Status must be pending, approved, or rejected.' });
    }
    await db.collection('dealerVerification').doc(targetUid).set({
      status,
      reviewedBy: uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('users').doc(targetUid).set({
      role: 'dealer',
      accountType: 'dealer',
      verificationStatus: status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await sendNotification(db, targetUid, {
      type: `verification_${status}`,
      title: status === 'approved' ? '🎉 Dealer Verified!' : 'Verification Update',
      message: status === 'approved'
        ? 'Your store has been approved. You can now publish listings!'
        : `Your verification was ${status}. Please contact support for assistance.`
    });
    return response.json({ ok: true, uid: targetUid, status });
  } catch (error) {
    console.error('[API] Admin verification update failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/admin/verifications  (admin only — list pending verifications)
router.get('/api/admin/verifications', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    let isAdminUser = request.user.admin === true;
    if (!isAdminUser) {
      const userSnap = await db.collection('users').doc(uid).get();
      isAdminUser = userSnap.exists && userSnap.data().role === 'admin' && userSnap.data().accountType === 'admin';
    }
    if (!isAdminUser) return response.status(403).json({ error: 'Admin access required.' });
    const statusFilter = request.query.status || 'pending';
    let q = db.collection('dealerVerification');
    if (statusFilter !== 'all') q = q.where('status', '==', statusFilter);
    q = q.orderBy('submittedAt', 'desc').limit(100);
    const snap = await q.get();
    const verifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return response.json({ ok: true, verifications });
  } catch (error) {
    console.error('[API] Admin verifications list failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/admin/swaps  (admin only — list swap requests)
router.get('/api/admin/swaps', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    let isAdminUser = request.user.admin === true;
    if (!isAdminUser) {
      const userSnap = await db.collection('users').doc(uid).get();
      isAdminUser = userSnap.exists && userSnap.data().role === 'admin' && userSnap.data().accountType === 'admin';
    }
    if (!isAdminUser) return response.status(403).json({ error: 'Admin access required.' });
    const statusFilter = request.query.status;
    let q = db.collection('swapRequests').orderBy('createdAt', 'desc').limit(200);
    if (statusFilter && statusFilter !== 'all') {
      q = db.collection('swapRequests').where('status', '==', statusFilter).orderBy('createdAt', 'desc').limit(200);
    }
    const snap = await q.get();
    const swaps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return response.json({ ok: true, swaps });
  } catch (error) {
    console.error('[API] Admin swaps list failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/swap/messages (in-app chat)
router.post('/api/swap/messages', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const text = requireString(request.body.text, 'text', 2000);
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const requestRef = db.collection('swapRequests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap request not found.' });
    const data = snap.data();
    if (data.customerUid !== uid && data.dealerUid !== uid && !request.user.admin) {
      return response.status(403).json({ error: 'You are not a participant in this swap.' });
    }
    const isCustomer = uid === data.customerUid;
    const senderRole = isCustomer ? 'customer' : (uid === data.dealerUid ? 'dealer' : 'admin');
    const senderName = String(request.body.senderName || (isCustomer ? (data.customerName || 'Customer') : (data.storeName || 'Store'))).slice(0, 100);
    const messageDoc = {
      requestId,
      senderUid: uid,
      senderRole,
      senderName,
      text,
      type: String(request.body.type || 'text').slice(0, 30),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await requestRef.collection('messages').add(messageDoc);
    // Notify counterparty
    const recipientUid = isCustomer ? data.dealerUid : data.customerUid;
    if (recipientUid) {
      await sendNotification(db, recipientUid, {
        type: 'chat_message',
        requestId,
        title: `Message from ${senderName}`,
        message: text.length > 80 ? text.slice(0, 77) + '...' : text
      });
    }
    return response.json({ ok: true, messageId: ref.id, ...messageDoc });
  } catch (error) {
    console.error('[API] Send message failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/swap/messages
router.get('/api/swap/messages', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.query.requestId, 'requestId', 128);
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const snap = await db.collection('swapRequests').doc(requestId).get();
    if (!snap.exists) return response.status(404).json({ error: 'Swap not found.' });
    const data = snap.data();
    if (data.customerUid !== uid && data.dealerUid !== uid && !request.user.admin) {
      return response.status(403).json({ error: 'Unauthorized to view messages.' });
    }
    const msgsSnap = await db.collection('swapRequests').doc(requestId)
      .collection('messages').orderBy('createdAt', 'asc').limit(100).get();
    const messages = msgsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return response.json({ ok: true, messages });
  } catch (error) {
    console.error('[API] Get messages failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/reviews
router.post('/api/reviews', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const requestId = requireString(request.body.requestId, 'requestId', 128);
    const rating = Math.min(5, Math.max(1, parseInt(request.body.rating || 5, 10)));
    const reviewText = requireString(request.body.comment || request.body.reviewText, 'review', 1000);
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    const swapSnap = await db.collection('swapRequests').doc(requestId).get();
    if (!swapSnap.exists) return response.status(404).json({ error: 'Swap not found.' });
    const swap = swapSnap.data();
    if (swap.customerUid !== uid && swap.dealerUid !== uid) {
      return response.status(403).json({ error: 'You are not a participant in this swap.' });
    }
    const storeId = swap.dealerUid || swap.storeId;
    const reviewDoc = {
      requestId,
      storeId,
      authorUid: uid,
      authorName: String(request.body.authorName || (uid === swap.customerUid ? (swap.customerName || 'Customer') : (swap.storeName || 'Dealer'))).slice(0, 100),
      authorRole: uid === swap.customerUid ? 'customer' : 'dealer',
      rating,
      comment: reviewText,
      targetDeviceModel: swap.targetDevice?.model || 'Device',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('reviews').add(reviewDoc);
    return response.json({ ok: true, reviewId: ref.id, review: reviewDoc });
  } catch (error) {
    console.error('[API] Review submission failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/reviews
router.get('/api/reviews', async (request, response) => {
  try {
    const storeId = String(request.query.storeId || '').trim();
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    let q = db.collection('reviews');
    if (storeId) {
      q = q.where('storeId', '==', storeId);
    }
    q = q.orderBy('createdAt', 'desc').limit(50);
    const snap = await q.get();
    const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalRating = reviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0);
    const averageRating = reviews.length > 0 ? (totalRating / reviews.length).toFixed(1) : '5.0';
    return response.json({ ok: true, reviews, averageRating: Number(averageRating), count: reviews.length });
  } catch (error) {
    console.error('[API] Reviews query failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/certificate
router.get('/api/certificate', async (request, response) => {
  try {
    const id = String(request.query.id || '').trim();
    if (!id) return response.status(400).json({ error: 'Certificate/Request ID is required.' });
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    let swapDoc = null;
    if (id.startsWith('NS-CERT-')) {
      const q = await db.collection('swapRequests').where('inspectionReportId', '==', id).limit(1).get();
      if (!q.empty) swapDoc = q.docs[0];
    } else {
      const docSnap = await db.collection('swapRequests').doc(id).get();
      if (docSnap.exists) swapDoc = docSnap;
    }
    if (!swapDoc) return response.status(404).json({ error: 'Inspection Certificate not found.' });
    const data = swapDoc.data();
    return response.json({
      ok: true,
      certificate: {
        reportId: data.inspectionReportId || ('NS-CERT-' + swapDoc.id.slice(0, 8).toUpperCase()),
        requestId: swapDoc.id,
        inspectionStatus: data.inspectionStatus || 'pending',
        technicianName: data.technicianName || 'Certified Hub Technician',
        hubLocation: data.hubLocation || 'Computer Village Hub, Ikeja, Lagos',
        notes: data.inspectionNotes || '',
        inspectedAt: data.inspectedAt || data.updatedAt,
        diagnosticDetails: data.diagnosticDetails || {
          screenPassed: true,
          batteryHealth: 94,
          icloudSignedOut: true,
          camerasPassed: true,
          biometricsPassed: true,
          imeiClean: true,
          physicalGrade: 'Grade A'
        },
        device: data.currentDevice || {},
        targetDevice: data.targetDevice || {},
        storeName: data.storeName || 'Verified Partner Store'
      }
    });
  } catch (error) {
    console.error('[API] Certificate lookup failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/admin/setup-role (dev/admin helper to grant admin/technician role to caller)
router.post('/api/admin/setup-role', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const targetRole = String(request.body.role || 'admin').trim().toLowerCase();
    if (!['admin', 'technician', 'dealer', 'customer'].includes(targetRole)) {
      return response.status(400).json({ error: 'Invalid role.' });
    }
    const firebase = getFirebaseAdmin();
    const db = firebase.firestore();
    await db.collection('users').doc(uid).set({
      role: targetRole,
      accountType: targetRole === 'technician' ? 'technician' : targetRole,
      isTechnician: targetRole === 'technician' || targetRole === 'admin',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({ ok: true, uid, role: targetRole });
  } catch (error) {
    console.error('[API] Setup role failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

module.exports = router;
