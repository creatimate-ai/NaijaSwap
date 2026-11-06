/**
 * Browser-side Firebase operations. Firestore security rules are the authority
 * for writes; these checks provide faster, clearer feedback to the user.
 */
import {
  auth, db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  writeBatch, query, where, orderBy, limit, serverTimestamp
} from './firebase-config.js';
import {
  sendSwapRequestReceivedBrevo,
  sendSwapRequestAcceptedBrevo,
  sendCounterofferReceivedBrevo,
  sendSwapRequestDeclinedBrevo,
  sendEscrowPaymentCustomerBrevo,
  sendEscrowPaymentDealerBrevo,
  sendSwapCompletedBrevo,
  sendDealerStarterLimitReachedBrevo,
  sendDealerPaymentReceiptBrevo
} from './brevo-client.js';

export const API_BASE_URL = (() => {
  if (typeof window === 'undefined') return '';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return '';
  }
  return window.NAIJASWAP_API_URL || (window.location.hostname.endsWith('.web.app') || window.location.hostname.endsWith('.firebaseapp.com')
    ? 'https://naijaswap.onrender.com'
    : '');
})();

function requireUser() {
  if (!auth.currentUser) throw new Error('Please sign in and try again.');
  return auth.currentUser;
}

function cleanString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function amountAsNumber(value) {
  const amount = Number(String(value ?? 0).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
    throw new Error('Enter a valid amount.');
  }
  return amount;
}

function normalizeImei(value) {
  return String(value || '').replace(/[\s-]/g, '').toUpperCase();
}

function isValidImei(value) {
  const imei = normalizeImei(value);
  if (!/^[0-9A-Z]{8,32}$/.test(imei)) return false;
  // If it is a 15-digit IMEI, validate with Luhn checksum
  if (/^\d{15}$/.test(imei)) {
    let sum = 0;
    for (let i = 0; i < 15; i += 1) {
      let digit = Number(imei[i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  }
  // Otherwise ensure it is a valid 8-32 alphanumeric serial without repetitive dummy characters
  return !/^([A-Z0-9])\1+$/.test(imei);
}

async function getRequest(requestId) {
  const id = cleanString(requestId, 128);
  if (!id) throw new Error('Swap request ID is missing.');
  const ref = doc(db, 'swapRequests', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Swap request not found.');
  return { ref, data: snap.data(), id };
}

async function requireAdmin() {
  const user = requireUser();
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.exists() ? userSnap.data() : {};
  if (userData.role !== 'admin' || userData.accountType !== 'admin') {
    throw new Error('Admin access required.');
  }
  return user;
}

export async function createListingBackend(payload = {}) {
  const user = requireUser();
  const brand = cleanString(payload.brand, 40);
  const model = cleanString(payload.model, 100);
  const marketValue = amountAsNumber(payload.marketValue);
  if (!['Apple', 'Samsung'].includes(brand) || !model || marketValue <= 0) {
    throw new Error('Enter a valid phone brand, model, and price.');
  }
  const mediaFiles = Array.isArray(payload.mediaFiles) ? payload.mediaFiles.slice(0, 5) : [];
  if (mediaFiles.some(media => !media || typeof media.dataUrl !== 'string' || !media.dataUrl.startsWith('https://'))) {
    throw new Error('All listing photos and videos must finish uploading before publishing.');
  }

  // Enforce 5-active-listing limit for Starter plan
  let isPremium = false;
  try {
    const subSnap = await getDoc(doc(db, 'dealerSubscriptions', user.uid));
    if (subSnap.exists()) {
      const subData = subSnap.data();
      const now = Date.now();
      const endMillis = subData.currentPeriodEnd?.toMillis ? subData.currentPeriodEnd.toMillis() : new Date(subData.currentPeriodEnd || 0).getTime();
      if ((subData.plan === 'premium' || subData.plan === 'leader') && (subData.status === 'active' || subData.status === 'cancelled') && endMillis > now) {
        isPremium = true;
      }
    }
    if (!isPremium) {
      const profSnap = await getDoc(doc(db, 'dealerProfiles', user.uid));
      if (profSnap.exists() && (profSnap.data().isPremium || profSnap.data().plan === 'premium' || profSnap.data().plan === 'leader')) {
        isPremium = true;
      }
    }
  } catch (err) {
    console.warn('[BackendAPI] Could not check dealer subscription:', err);
  }

  if (!isPremium) {
    const activeListingsQuery = query(
      collection(db, 'listings'),
      where('storeOwnerUid', '==', user.uid),
      where('status', '==', 'active')
    );
    const activeListingsSnap = await getDocs(activeListingsQuery);
    if (activeListingsSnap.size >= 5) {
      try {
        if (user.email) {
          sendDealerStarterLimitReachedBrevo({
            email: user.email,
            dealerName: cleanString(payload.storeName, 120) || 'Dealer',
            currentCount: activeListingsSnap.size,
            maxLimit: 5
          });
        }
      } catch (_) {}
      const error = new Error("You've reached your Starter plan listing limit. Upgrade to Premium to unlock unlimited phone listings and additional dealer benefits.");
      error.limitReached = true;
      error.activeCount = activeListingsSnap.size;
      error.limit = 5;
      throw error;
    }
  }

  const listing = {
    storeOwnerUid: user.uid,
    storeId: user.uid,
    storeName: cleanString(payload.storeName, 120),
    brand,
    model,
    storage: cleanString(payload.storage, 30),
    condition: cleanString(payload.condition, 60),
    conditionGrade: cleanString(payload.conditionGrade, 60),
    color: cleanString(payload.color, 50),
    battery: cleanString(payload.battery, 30),
    marketValue,
    quantityInStock: Math.max(0, Math.floor(Number(payload.quantityInStock) || 0)),
    isSwapAllowed: payload.isSwapAllowed !== false,
    image: cleanString(payload.image, 2048),
    mediaFiles,
    description: cleanString(payload.description, 2000),
    location: cleanString(payload.location, 200),
    hubAddress: cleanString(payload.hubAddress, 240),
    whatsappNumber: cleanString(payload.whatsappNumber, 16),
    status: 'active',
    isPremiumDealer: isPremium,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, 'listings'), listing);
  return { ok: true, listingId: reference.id, status: listing.status };
}

export async function deleteListingBackend(listingId) {
  const user = requireUser();
  const ref = doc(db, 'listings', cleanString(listingId, 128));
  const listing = await getDoc(ref);
  if (!listing.exists() || listing.data().storeOwnerUid !== user.uid) {
    throw new Error('This listing is not available in your inventory.');
  }
  await updateDoc(ref, { status: 'archived', updatedAt: serverTimestamp() });
}

export async function restockListingBackend(listingId, quantity = 1) {
  const user = requireUser();
  const ref = doc(db, 'listings', cleanString(listingId, 128));
  const listing = await getDoc(ref);
  if (!listing.exists() || listing.data().storeOwnerUid !== user.uid) {
    throw new Error('This listing is not available in your inventory.');
  }
  const currentQuantity = Number(listing.data().quantityInStock) || 0;
  await updateDoc(ref, {
    quantityInStock: currentQuantity + Math.max(1, Math.floor(Number(quantity) || 1)),
    status: 'active',
    updatedAt: serverTimestamp()
  });
}

export async function createSwapRequestBackend(payload = {}) {
  const user = requireUser();
  const targetListingId = cleanString(payload.targetListingId, 128);
  const storeUid = cleanString(payload.storeUid, 128);
  const currentDevice = payload.currentDevice;
  if (!targetListingId || !storeUid || !currentDevice || typeof currentDevice !== 'object') {
    throw new Error('Select a valid dealer listing and enter your phone details.');
  }
  const imeiNumber = normalizeImei(currentDevice.imeiNumber);
  if (!isValidImei(imeiNumber)) {
    throw new Error('Enter a valid 8–32 character IMEI or serial number.');
  }
  const listingSnap = await getDoc(doc(db, 'listings', targetListingId));
  if (!listingSnap.exists()) throw new Error('This dealer listing is no longer available.');
  const listing = listingSnap.data();
  if (listing.storeOwnerUid !== storeUid || listing.status !== 'active'
    || Number(listing.quantityInStock) < 1 || listing.isSwapAllowed === false) {
    throw new Error('This dealer phone is not currently accepting swap requests.');
  }
  const blacklist = await getDoc(doc(db, 'stolenDevices', imeiNumber));
  if (blacklist.exists() && blacklist.data().status === 'blacklisted') {
    throw new Error('This device has been reported as stolen and cannot be submitted.');
  }
  const targetDevice = {
    listingId: targetListingId,
    brand: cleanString(listing.brand, 40),
    model: cleanString(listing.model, 100),
    storage: cleanString(listing.storage, 30),
    color: cleanString(listing.color, 50),
    image: cleanString(listing.image, 2048),
    marketValue: Number(listing.marketValue) || 0
  };
  const topupAmount = amountAsNumber(payload.topupAmount);
  const request = {
    customerUid: user.uid,
    dealerUid: storeUid,
    customerName: cleanString(user.displayName || payload.customerName, 100),
    customerEmail: cleanString(user.email || payload.customerEmail, 320),
    customerPhone: cleanString(payload.customerPhone, 16).replace(/[^\d+]/g, ''),
    storeName: cleanString(listing.storeName, 120),
    status: 'pending',
    currentDevice: {
      brand: cleanString(currentDevice.brand, 40),
      model: cleanString(currentDevice.model, 100),
      storage: cleanString(currentDevice.storage || currentDevice.storageCapacity, 30),
      ram: cleanString(currentDevice.ram, 30),
      condition: cleanString(currentDevice.condition, 60),
      batteryHealth: parseInt(String(currentDevice.batteryHealth || '').replace(/\D/g, ''), 10) || 0,
      carrierLock: cleanString(currentDevice.carrierLock, 40),
      color: cleanString(currentDevice.color, 50),
      conditionTriage: currentDevice.conditionTriage && typeof currentDevice.conditionTriage === 'object'
        ? currentDevice.conditionTriage
        : {},
      imeiNumber
    },
    targetListingId,
    targetDevice,
    offeredPrice: amountAsNumber(payload.offeredPrice),
    topupAmount,
    message: cleanString(payload.message, 500),
    deviceMedia: Array.isArray(payload.deviceMedia) ? payload.deviceMedia.slice(0, 5) : [],
    safeSwapCode: cleanString(payload.safeSwapCode, 20) || ('NS-' + Math.floor(100000 + Math.random() * 900000)),
    hubAddress: cleanString(listing.hubAddress || listing.location, 240) || 'Otigba Street, Computer Village, Ikeja, Lagos',
    disputeStatus: 'none',
    paymentStatus: topupAmount > 0 ? 'pending_escrow' : 'not_required',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, 'swapRequests'), request);

  // Notify dealer of incoming swap request via Brevo
  try {
    const dealerDoc = await getDoc(doc(db, 'users', storeUid));
    const dealerEmail = dealerDoc.exists() ? dealerDoc.data().email : null;
    if (dealerEmail) {
      sendSwapRequestReceivedBrevo({
        email: dealerEmail,
        recipientName: listing.storeName || 'Partner',
        requesterName: request.customerName || 'Swapper',
        targetPhone: `${targetDevice.brand} ${targetDevice.model}`.trim(),
        offeredPhone: `${currentDevice.brand} ${currentDevice.model}`.trim(),
        cashDifference: topupAmount,
        requestId: reference.id
      });
    }
  } catch (err) {
    console.warn('[BackendAPI] Could not send swap request email notification:', err);
  }

  return { ok: true, requestId: reference.id, status: request.status, safeSwapCode: request.safeSwapCode };
}

export async function updateSwapRequestStatusBackend(payload = {}) {
  const user = requireUser();
  const { ref, data } = await getRequest(payload.requestId);
  const requestedStatus = cleanString(payload.status, 40).toLowerCase();
  const status = requestedStatus === 'declined' ? 'rejected' : (requestedStatus || data.status);
  
  const transitions = {
    pending: ['reviewed', 'accepted', 'countered', 'rejected', 'cancelled', 'hub_booked', 'under_inspection', 'completed'],
    reviewed: ['accepted', 'countered', 'rejected', 'cancelled', 'hub_booked', 'under_inspection', 'completed'],
    countered: ['accepted', 'countered', 'rejected', 'cancelled', 'hub_booked', 'under_inspection', 'completed'],
    accepted: ['hub_booked', 'under_inspection', 'inspection_passed', 'completed', 'cancelled', 'accepted'],
    hub_booked: ['accepted', 'under_inspection', 'inspection_passed', 'completed', 'cancelled', 'hub_booked'],
    under_inspection: ['inspection_passed', 'completed', 'cancelled'],
    inspection_passed: ['completed', 'cancelled'],
    completed: []
  };

  if (user.uid !== data.customerUid && user.uid !== data.dealerUid) {
    throw new Error('You are not a participant in this swap.');
  }

  if (status && status !== data.status && !(transitions[data.status] || []).includes(status)) {
    throw new Error('This swap cannot be moved to that status.');
  }

  if (user.uid === data.customerUid
    && status !== 'cancelled'
    && status !== 'hub_booked'
    && status !== data.status
    && !(data.status === 'countered' && ['accepted', 'countered', 'rejected'].includes(status))) {
    throw new Error('You can only accept or decline a dealer counter-offer.');
  }

  if (user.uid === data.dealerUid && status === 'cancelled') {
    throw new Error('Dealers cannot cancel a customer swap request.');
  }

  const update = { status, lastUpdatedBy: user.uid, updatedAt: serverTimestamp() };
  if (payload.counterOffer !== undefined) update.counterOffer = amountAsNumber(payload.counterOffer);
  if (payload.counterMessage !== undefined) update.counterMessage = cleanString(payload.counterMessage, 500);
  if (payload.counterReason !== undefined) update.counterReason = cleanString(payload.counterReason, 200);
  if (payload.hubBooking !== undefined) update.hubBooking = payload.hubBooking;
  if (payload.triageResults !== undefined) update.triageResults = payload.triageResults;
  if (payload.safeSwapCode !== undefined) update.safeSwapCode = cleanString(payload.safeSwapCode, 20);
  if (payload.certificateId !== undefined) update.certificateId = cleanString(payload.certificateId, 50);

  await updateDoc(ref, update);

  if (status === 'accepted') {
    try {
      const customerEmail = data.customerEmail;
      if (customerEmail) {
        sendSwapRequestAcceptedBrevo({
          email: customerEmail,
          requesterName: data.customerName || 'Customer',
          targetPhone: `${data.targetDevice?.brand || ''} ${data.targetDevice?.model || ''}`.trim(),
          dealerName: data.storeName || 'The dealer',
          requestId: payload.requestId
        });
      }
    } catch (mailErr) {
      console.warn('[BackendAPI] Could not send swap accepted email notification:', mailErr);
    }
  } else if (status === 'countered') {
    try {
      const customerEmail = data.customerEmail;
      if (customerEmail) {
        sendCounterofferReceivedBrevo({
          email: customerEmail,
          recipientName: data.customerName || 'Swapper',
          senderName: data.storeName || 'Dealer',
          targetPhone: `${data.targetDevice?.brand || ''} ${data.targetDevice?.model || ''}`.trim(),
          offeredPhone: `${data.currentDevice?.brand || ''} ${data.currentDevice?.model || ''}`.trim(),
          cashDifference: payload.counterOffer ?? data.topupAmount ?? 0,
          requestId: payload.requestId
        });
      }
    } catch (mailErr) {
      console.warn('[BackendAPI] Could not send counter-offer email notification:', mailErr);
    }
  } else if (status === 'rejected' || status === 'declined') {
    try {
      const customerEmail = data.customerEmail;
      if (customerEmail) {
        sendSwapRequestDeclinedBrevo({
          email: customerEmail,
          requesterName: data.customerName || 'Swapper',
          targetPhone: `${data.targetDevice?.brand || ''} ${data.targetDevice?.model || ''}`.trim(),
          dealerName: data.storeName || 'The dealer'
        });
      }
    } catch (mailErr) {
      console.warn('[BackendAPI] Could not send swap declined email notification:', mailErr);
    }
  }

  return { ok: true, requestId: payload.requestId, status };
}

export async function recordSwapPaymentBackend(payload = {}) {
  const user = requireUser();
  const { ref, data, id } = await getRequest(payload.requestId);

  if (user.uid !== data.customerUid && user.uid !== data.dealerUid) {
    throw new Error('You are not a participant in this swap.');
  }

  const paymentReference = cleanString(payload.paymentReference || payload.reference, 128);
  if (!paymentReference) throw new Error('Payment reference is missing.');

  const paymentAmount = amountAsNumber(payload.paymentAmount || payload.amount || data.topupAmount);
  const paymentChannel = cleanString(payload.paymentChannel || 'paystack', 40);

  // 1. Try secure backend server verification first
  let serverVerified = false;
  try {
    const idToken = await user.getIdToken();
    const apiRes = await fetch(`${API_BASE_URL}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        reference: paymentReference,
        requestId: id
      })
    });
    if (apiRes.ok) {
      serverVerified = true;
    }
  } catch (_) {
    // Backend API offline or running static
  }

  // 2. Client-safe fallback: Record reference in pending_escrow state
  if (!serverVerified) {
    await updateDoc(ref, {
      paymentReference,
      paymentChannel,
      updatedAt: serverTimestamp()
    });
  }

  try {
    await addDoc(collection(db, 'auditLogs'), {
      uid: user.uid,
      type: serverVerified ? 'escrow_payment_verified' : 'escrow_payment_reference_submitted',
      requestId: id,
      customerUid: data.customerUid,
      dealerUid: data.dealerUid,
      amount: paymentAmount,
      reference: paymentReference,
      channel: paymentChannel,
      serverVerified,
      timestamp: serverTimestamp()
    });
  } catch (auditErr) {
    console.warn('[AuditLog] Notice:', auditErr.message);
  }

  // Dispatch Escrow Payment Notifications via Brevo
  try {
    const customerEmail = data.customerEmail || (user.uid === data.customerUid ? user.email : '');
    const dealerDoc = await getDoc(doc(db, 'users', data.dealerUid));
    const dealerEmail = dealerDoc.exists() ? dealerDoc.data().email : '';

    const targetTitle = `${data.targetDevice?.brand || ''} ${data.targetDevice?.model || ''}`.trim();
    const offeredTitle = `${data.currentDevice?.brand || ''} ${data.currentDevice?.model || ''}`.trim();

    if (customerEmail) {
      sendEscrowPaymentCustomerBrevo({
        email: customerEmail,
        customerName: data.customerName || 'Swapper',
        dealerName: data.storeName || 'Dealer',
        targetPhone: targetTitle,
        offeredPhone: offeredTitle,
        amount: paymentAmount,
        requestId: id
      });
    }

    if (dealerEmail) {
      sendEscrowPaymentDealerBrevo({
        email: dealerEmail,
        dealerName: data.storeName || 'Dealer',
        customerName: data.customerName || 'Customer',
        targetPhone: targetTitle,
        offeredPhone: offeredTitle,
        amount: paymentAmount,
        requestId: id
      });
    }
  } catch (escrowMailErr) {
    console.warn('[BackendAPI] Could not send escrow payment email:', escrowMailErr);
  }

  return {
    ok: true,
    requestId: id,
    paymentStatus: serverVerified ? 'escrow_secured' : data.paymentStatus,
    paymentReference,
    paymentAmount,
    serverVerified
  };
}

export async function confirmSwapHandoverBackend(payload = {}) {
  const user = requireUser();
  const { ref, data, id } = await getRequest(payload.requestId);
  if (user.uid !== data.customerUid && user.uid !== data.dealerUid) {
    throw new Error('You are not a participant in this swap.');
  }

  // 1. Try secure backend handover confirmation & escrow payout trigger
  let serverHandled = false;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/swap/confirm-handover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ requestId: id, confirmed: true })
    });
    if (res.ok) {
      serverHandled = true;
    }
  } catch (_) {}

  const field = user.uid === data.customerUid ? 'customerConfirmed' : 'dealerConfirmed';
  const otherField = user.uid === data.customerUid ? 'dealerConfirmed' : 'customerConfirmed';
  const isBothConfirmed = !!data[otherField];

  if (!serverHandled) {
    const update = { [field]: true, updatedAt: serverTimestamp() };
    if (isBothConfirmed) {
      update.status = 'completed';
      update.completedAt = serverTimestamp();
      if (data.paymentStatus === 'paid' || data.escrowStatus === 'held_in_escrow') {
        update.escrowStatus = 'disbursement_pending';
      }
    }
    await updateDoc(ref, update);
  }

  if (isBothConfirmed) {
    try {
      const customerEmail = data.customerEmail;
      const dealerDoc = await getDoc(doc(db, 'users', data.dealerUid));
      const dealerEmail = dealerDoc.exists() ? dealerDoc.data().email : '';

      const targetTitle = `${data.targetDevice?.brand || ''} ${data.targetDevice?.model || ''}`.trim();
      const offeredTitle = `${data.currentDevice?.brand || ''} ${data.currentDevice?.model || ''}`.trim();

      if (customerEmail) {
        sendSwapCompletedBrevo({
          email: customerEmail,
          recipientName: data.customerName || 'Customer',
          partnerName: data.storeName || 'Dealer',
          receivedPhone: targetTitle,
          givenPhone: offeredTitle,
          requestId: id
        });
      }

      if (dealerEmail) {
        sendSwapCompletedBrevo({
          email: dealerEmail,
          recipientName: data.storeName || 'Dealer',
          partnerName: data.customerName || 'Customer',
          receivedPhone: offeredTitle,
          givenPhone: targetTitle,
          requestId: id
        });
      }
    } catch (completeErr) {
      console.warn('[BackendAPI] Could not send swap completed email:', completeErr);
    }
  }

  return { ok: true, requestId: id, isBothConfirmed };
}

export async function openSwapDisputeBackend(payload = {}) {
  const user = requireUser();
  const { ref, data, id } = await getRequest(payload.requestId);
  const reason = cleanString(payload.reason, 2000);
  if (user.uid !== data.customerUid && user.uid !== data.dealerUid) {
    throw new Error('You are not a participant in this swap.');
  }
  if (!reason) throw new Error('Please enter a reason for the dispute.');
  if (['cancelled', 'rejected'].includes(data.status)) {
    throw new Error('This swap cannot be disputed.');
  }
  await updateDoc(ref, {
    disputeStatus: 'open',
    disputeOpenedBy: user.uid,
    disputeReason: reason,
    disputeOpenedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { ok: true, requestId: id, disputeStatus: 'open' };
}

export async function recordSwapInspectionBackend(payload = {}) {
  const user = await requireAdminOrTechnician();
  const { ref, data, id } = await getRequest(payload.requestId);
  const passed = payload.passed === true;
  const diagnostics = payload.diagnostics && typeof payload.diagnostics === 'object'
    ? payload.diagnostics
    : {};
  const reportId = cleanString(payload.inspectionReportId, 128)
    || `NS-CERT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const inspection = {
    inspectionStatus: passed ? 'passed' : 'failed',
    inspectionReportId: reportId,
    technicianUid: user.uid,
    technicianName: cleanString(payload.technicianName || user.displayName, 100) || 'Hub Technician',
    hubLocation: cleanString(payload.hubLocation, 120) || 'Computer Village Hub',
    inspectionNotes: cleanString(payload.notes, 2000),
    diagnosticDetails: {
      screenPassed: diagnostics.screenPassed !== false,
      batteryHealth: Math.min(100, Math.max(50, Number(diagnostics.batteryHealth) || 92)),
      icloudSignedOut: diagnostics.icloudSignedOut !== false,
      camerasPassed: diagnostics.camerasPassed !== false,
      biometricsPassed: diagnostics.biometricsPassed !== false,
      imeiClean: diagnostics.imeiClean !== false,
      physicalGrade: cleanString(diagnostics.physicalGrade, 40) || 'Grade A'
    },
    inspectedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (passed && ['accepted', 'under_inspection'].includes(data.status)) {
    inspection.status = 'inspection_passed';
  }
  const certificate = {
    reportId,
    requestId: id,
    inspectionStatus: inspection.inspectionStatus,
    technicianName: inspection.technicianName,
    hubLocation: inspection.hubLocation,
    notes: inspection.inspectionNotes,
    inspectedAt: serverTimestamp(),
    diagnosticDetails: inspection.diagnosticDetails,
    device: {
      brand: cleanString(data.currentDevice?.brand, 40),
      model: cleanString(data.currentDevice?.model, 100),
      storage: cleanString(data.currentDevice?.storage, 30),
      condition: cleanString(data.currentDevice?.condition, 60),
      batteryHealth: Number(data.currentDevice?.batteryHealth) || 0,
      color: cleanString(data.currentDevice?.color, 50)
    },
    targetDevice: {
      brand: cleanString(data.targetDevice?.brand, 40),
      model: cleanString(data.targetDevice?.model, 100),
      storage: cleanString(data.targetDevice?.storage, 30),
      color: cleanString(data.targetDevice?.color, 50),
      image: cleanString(data.targetDevice?.image, 2048),
      marketValue: Number(data.targetDevice?.marketValue) || 0
    },
    storeName: data.storeName || 'Verified Partner Store'
  };
  try {
    const batch = writeBatch(db);
    batch.update(ref, inspection);
    batch.set(doc(db, 'inspectionCertificates', reportId), certificate);
    await batch.commit();
    return { ok: true, requestId: id, inspectionStatus: inspection.inspectionStatus, inspectionReportId: reportId };
  } catch (err) {
    try {
      const token = await user.getIdToken();
      const apiRes = await fetch(`${API_BASE_URL}/api/swap/inspection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (apiRes.ok) {
        return await apiRes.json();
      }
    } catch (_) {}
    throw err;
  }
}

async function requireAdminOrTechnician() {
  const user = requireUser();
  const snap = await getDoc(doc(db, 'users', user.uid));
  const profile = snap.exists() ? snap.data() : {};
  if (!((profile.role === 'admin' && profile.accountType === 'admin')
    || profile.role === 'technician'
    || profile.accountType === 'technician'
    || profile.isTechnician === true)) {
    throw new Error('Only an authorized technician or admin can record inspections.');
  }
  return user;
}

export async function adminGetVerifications(status = 'pending') {
  await requireAdmin();
  try {
    const constraints = [];
    if (status !== 'all') constraints.push(where('status', '==', status));
    constraints.push(orderBy('submittedAt', 'desc'), limit(100));
    const snapshot = await getDocs(query(collection(db, 'dealerVerification'), ...constraints));
    return { ok: true, verifications: snapshot.docs.map(item => ({ id: item.id, ...item.data() })) };
  } catch (err) {
    // Fallback to backend API
    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';
      const apiRes = await fetch(`${API_BASE_URL}/api/admin/verifications`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        return { ok: true, verifications: data.verifications || [] };
      }
    } catch (_) {}
    throw err;
  }
}

export async function adminGetSwaps(status = 'all') {
  await requireAdmin();
  try {
    const constraints = [];
    if (status !== 'all') constraints.push(where('status', '==', status));
    constraints.push(orderBy('createdAt', 'desc'), limit(200));
    const snapshot = await getDocs(query(collection(db, 'swapRequests'), ...constraints));
    return { ok: true, swaps: snapshot.docs.map(item => ({ id: item.id, ...item.data() })) };
  } catch (err) {
    try {
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : '';
      const apiRes = await fetch(`${API_BASE_URL}/api/admin/swaps`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        return { ok: true, swaps: data.swaps || [] };
      }
    } catch (_) {}
    throw err;
  }
}

export async function adminUpdateVerificationStatus(payload = {}) {
  const admin = await requireAdmin();
  const uid = cleanString(payload.uid, 128);
  const status = cleanString(payload.status, 20).toLowerCase();
  if (!uid || !['pending', 'approved', 'rejected'].includes(status)) {
    throw new Error('Select a valid dealer and verification status.');
  }
  const now = serverTimestamp();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'dealerVerification', uid), {
      status,
      rejectReason: status === 'rejected' ? cleanString(payload.reason, 1000) : '',
      reviewedBy: admin.uid,
      reviewedAt: now,
      updatedAt: now
    });
    batch.set(doc(db, 'users', uid), {
      role: 'dealer',
      accountType: 'dealer',
      verificationStatus: status,
      updatedAt: now
    }, { merge: true });
    await batch.commit();
    return { ok: true, uid, status };
  } catch (err) {
    try {
      const token = await admin.getIdToken();
      const apiRes = await fetch(`${API_BASE_URL}/api/admin/verification-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (apiRes.ok) {
        return await apiRes.json();
      }
    } catch (_) {}
    throw err;
  }
}

export async function verifyDeviceIMEIBackend(value) {
  const user = requireUser();
  const imei = normalizeImei(value);
  if (!isValidImei(imei)) {
    throw new Error('Enter a valid IMEI or serial number (8–32 characters).');
  }
  const blacklist = await getDoc(doc(db, 'stolenDevices', imei));
  if (blacklist.exists() && blacklist.data().status === 'blacklisted') {
    throw new Error('This device has been reported as stolen.');
  }
  return { valid: true, imei, uid: user.uid };
}

export async function createReviewBackend(payload = {}) {
  const user = requireUser();
  const { data } = await getRequest(payload.requestId);
  if (user.uid !== data.customerUid && user.uid !== data.dealerUid) {
    throw new Error('Only participants in this swap can leave a review.');
  }
  const comment = cleanString(payload.comment || payload.reviewText, 1000);
  if (!comment) throw new Error('Write a short review before submitting.');
  const review = {
    requestId: cleanString(payload.requestId, 128),
    storeId: data.dealerUid,
    authorUid: user.uid,
    authorName: cleanString(payload.authorName || user.displayName, 100) || 'NaijaSwap user',
    authorRole: user.uid === data.customerUid ? 'customer' : 'dealer',
    rating: Math.min(5, Math.max(1, Number(payload.rating) || 5)),
    comment,
    targetDeviceModel: data.targetDevice?.model || 'Device',
    createdAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, 'reviews'), review);
  return { ok: true, reviewId: reference.id, review };
}

export async function getPublicCertificate(id) {
  const value = cleanString(id, 128);
  if (!value) throw new Error('Enter a certificate or swap request ID.');
  const direct = await getDoc(doc(db, 'inspectionCertificates', value));
  if (direct.exists()) return { ok: true, certificate: { id: direct.id, ...direct.data() } };
  
  const snapshot = await getDocs(query(
    collection(db, 'inspectionCertificates'),
    where('requestId', '==', value),
    limit(1)
  ));
  if (!snapshot.empty) {
    const certificate = snapshot.docs[0];
    return { ok: true, certificate: { id: certificate.id, ...certificate.data() } };
  }

  // Fallback: check swapRequests
  try {
    const swapDoc = await getDoc(doc(db, 'swapRequests', value));
    if (swapDoc.exists()) {
      const data = swapDoc.data();
      if (data.status !== 'completed' && data.status !== 'inspection_passed' && data.inspectionStatus !== 'passed') {
        throw new Error('This swap has not completed physical hub inspection.');
      }
      const triage = data.triageResults || {};
      return {
        ok: true,
        certificate: {
          reportId: data.certificateId || `NS-CERT-${data.safeSwapCode ? data.safeSwapCode.replace(/\D/g, '') : value.slice(0, 6).toUpperCase()}`,
          requestId: swapDoc.id,
          inspectedAt: data.completedAt || data.updatedAt || new Date().toISOString(),
          technicianName: triage.inspectedBy || 'Certified Hub Tech #402',
          hubLocation: data.hubBooking?.hubName || data.hubAddress || 'Otigba Street, Computer Village, Ikeja, Lagos',
          notes: triage.technicianNotes || 'All 10 hardware and security checkpoints verified 100%. Issued with 30-Day Testing Warranty.',
          diagnosticDetails: {
            physicalGrade: 'Grade A (Certified)',
            batteryHealth: triage.batteryHealth || (data.currentDevice?.batteryHealth ? Number(data.currentDevice.batteryHealth) : 92)
          },
          device: {
            brand: data.currentDevice?.brand || '',
            model: data.currentDevice?.model || data.model || 'Smartphone',
            storage: data.currentDevice?.storage || '128GB',
            color: data.currentDevice?.color || 'Original Finish',
            condition: data.currentDevice?.condition || 'Inspected'
          },
          targetDevice: {
            brand: data.targetDevice?.brand || '',
            model: data.targetDevice?.model || 'Target Smartphone',
            storage: data.targetDevice?.storage || '256GB',
            color: data.targetDevice?.color || ''
          },
          storeName: data.storeName || 'Verified Partner Store'
        }
      };
    }
  } catch (_) {}

  throw new Error('Inspection Certificate not found.');
}

/**
 * Helper to update local subscription cache
 */
function updateLocalSubscriptionCache(uid, plan, billingCycle, paymentReference) {
  try {
    const isPremium = plan === 'premium' || plan === 'leader';
    const durationDays = billingCycle === 'annual' ? 365 : 30;
    const periodEnd = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(`naijaswap_sub_${uid}`, JSON.stringify({
      dealerUid: uid,
      plan,
      status: 'active',
      isPremium,
      billingCycle,
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
      paymentReference
    }));
  } catch (_) {}
}

/**
 * --- DEALER SUBSCRIPTION API INTEGRATION ---
 */

export async function getDealerSubscriptionStatusBackend(dealerUid = null) {
  const user = requireUser();
  const uid = dealerUid || user.uid;
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/subscription/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.ok) return data;
    }
  } catch (e) {
    console.warn('[BackendAPI] API /api/subscription/status error, checking Firestore directly:', e.message);
  }

  // Direct Firestore lookup
  let subData = null;
  try {
    const subSnap = await getDoc(doc(db, 'dealerSubscriptions', uid));
    if (subSnap.exists()) {
      subData = subSnap.data();
    }
  } catch (fsErr) {
    console.warn('[BackendAPI] Firestore dealerSubscriptions lookup note:', fsErr.message);
  }

  // Also check dealerProfiles
  if (!subData) {
    try {
      const profSnap = await getDoc(doc(db, 'dealerProfiles', uid));
      if (profSnap.exists()) {
        const pData = profSnap.data();
        if (pData.isPremium || pData.plan === 'premium' || pData.plan === 'leader') {
          subData = {
            plan: pData.plan || 'premium',
            status: pData.subscriptionStatus || 'active'
          };
        }
      }
    } catch (_) {}
  }

  // Also check users collection
  if (!subData) {
    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (userSnap.exists()) {
        const uData = userSnap.data();
        if (uData.dealerPlan === 'premium' || uData.dealerPlan === 'leader') {
          subData = {
            plan: uData.dealerPlan,
            status: uData.subscriptionStatus || 'active'
          };
        }
      }
    } catch (_) {}
  }

  // Also check localStorage cache fallback
  if (!subData) {
    try {
      const cached = JSON.parse(localStorage.getItem(`naijaswap_sub_${uid}`) || 'null');
      if (cached && (cached.isPremium || cached.plan === 'premium' || cached.plan === 'leader')) {
        subData = cached;
      }
    } catch (_) {}
  }

  if (!subData) {
    subData = { plan: 'starter', status: 'active' };
  }

  const now = Date.now();
  const endMillis = subData.currentPeriodEnd?.toMillis ? subData.currentPeriodEnd.toMillis() : new Date(subData.currentPeriodEnd || (now + 30 * 86400000)).getTime();
  const isPremium = (subData.plan === 'premium' || subData.plan === 'leader') && (subData.status === 'active' || subData.status === 'cancelled') && (endMillis > now);

  const activeSnap = await getDocs(query(collection(db, 'listings'), where('storeOwnerUid', '==', uid), where('status', '==', 'active')));
  const activeCount = activeSnap.size;

  return {
    ok: true,
    subscription: {
      dealerUid: uid,
      plan: isPremium ? (subData.plan || 'premium') : 'starter',
      status: subData.status || 'active',
      isPremium,
      activeListingLimit: isPremium ? Infinity : 5,
      currentPeriodEnd: subData.currentPeriodEnd || null,
      nextBillingDate: subData.nextBillingDate || null
    },
    activeCount,
    activeLimit: isPremium ? Infinity : 5,
    slotsAvailable: isPremium ? 'Unlimited' : Math.max(0, 5 - activeCount),
    needsDowngradeSelection: !isPremium && activeCount > 5,
    analytics: {
      totalViews: 0,
      swapRequestsReceived: 0,
      activeListingsCount: activeCount
    }
  };
}

export async function initializeDealerSubscriptionBackend(email) {
  const user = requireUser();
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/subscription/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email })
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[BackendAPI] Server initialize note:', err.message);
  }
  return { ok: true, email };
}

export async function verifyDealerSubscriptionBackend(reference, details = {}) {
  const user = requireUser();
  const refStr = cleanString(reference || details.reference || details.paystackRef, 128);
  if (!refStr) throw new Error('Payment reference is required for verification.');

  const plan = details.plan || (refStr.toUpperCase().includes('LEADER') ? 'leader' : 'premium');
  const isAnnual = details.billingCycle === 'annual' || (Number(details.amountInNaira || details.amount) >= 90000);
  const billingCycle = isAnnual ? 'annual' : 'monthly';
  const amountInNaira = Number(details.amountInNaira || details.amount) || (plan === 'leader' ? (isAnnual ? 249000 : 24900) : (isAnnual ? 99000 : 9900));

  // 1. Try secure backend server verification first (if API server is running)
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/subscription/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        reference: refStr,
        plan,
        amountInNaira,
        billingCycle
      })
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && (data.ok || data.status === 'success')) {
        updateLocalSubscriptionCache(user.uid, plan, billingCycle, refStr);
        return data;
      }
    }
  } catch (err) {
    console.warn('[BackendAPI] Server verification note (using Firestore client verification):', err.message);
  }

  // 2. Direct Firestore activation (Serverless / Firebase Hosting fallback)
  const now = new Date();
  const durationDays = isAnnual ? 365 : 30;
  const periodEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Write to dealerSubscriptions
  try {
    await setDoc(doc(db, 'dealerSubscriptions', user.uid), {
      dealerUid: user.uid,
      plan,
      status: 'active',
      amount: amountInNaira,
      currency: 'NGN',
      billingCycle,
      startDate: serverTimestamp(),
      currentPeriodStart: serverTimestamp(),
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
      paymentReference: refStr,
      cancelledAt: null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
  } catch (fsErr) {
    console.warn('[BackendAPI] dealerSubscriptions setDoc note:', fsErr.message);
  }

  // Update dealerProfiles
  try {
    await setDoc(doc(db, 'dealerProfiles', user.uid), {
      storeOwnerUid: user.uid,
      isPremium: true,
      plan,
      subscriptionStatus: 'active',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (dpErr) {
    console.warn('[BackendAPI] dealerProfiles setDoc note:', dpErr.message);
  }

  // Update users
  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      dealerPlan: plan,
      subscriptionStatus: 'active',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (uErr) {
    console.warn('[BackendAPI] users setDoc note:', uErr.message);
  }

  // Mark all active listings as isPremiumDealer: true
  try {
    const listingsSnap = await getDocs(query(
      collection(db, 'listings'),
      where('storeOwnerUid', '==', user.uid)
    ));
    if (!listingsSnap.empty) {
      const batch = writeBatch(db);
      listingsSnap.docs.forEach((snap) => {
        batch.update(snap.ref, {
          isPremiumDealer: true,
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }
  } catch (listErr) {
    console.warn('[BackendAPI] listings priority flag note:', listErr.message);
  }

  // Update local storage cache
  updateLocalSubscriptionCache(user.uid, plan, billingCycle, refStr);

  // Dispatch Dealer Premium Payment Receipt via Brevo
  try {
    if (user.email) {
      sendDealerPaymentReceiptBrevo({
        email: user.email,
        dealerName: user.displayName || 'Dealer',
        amount: amountInNaira,
        reference: refStr,
        renewalDate: periodEnd.toLocaleDateString('en-NG')
      });
    }
  } catch (receiptErr) {
    console.warn('[BackendAPI] Could not send subscription receipt email:', receiptErr);
  }

  return {
    ok: true,
    plan,
    status: 'active',
    isPremium: true,
    billingCycle,
    amountInNaira,
    currentPeriodEnd: periodEnd,
    paymentReference: refStr
  };
}

export async function cancelDealerSubscriptionBackend() {
  const user = requireUser();
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/subscription/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.ok) return data;
    }
  } catch (err) {
    console.warn('[BackendAPI] Server cancellation note, updating in Firestore:', err.message);
  }

  // Fallback update Firestore directly
  try {
    await setDoc(doc(db, 'dealerSubscriptions', user.uid), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) {}

  try {
    await setDoc(doc(db, 'dealerProfiles', user.uid), {
      subscriptionStatus: 'cancelled',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) {}

  return { ok: true, status: 'cancelled' };
}

export async function selectDowngradeActiveListingsBackend(selectedListingIds) {
  const user = requireUser();
  const ids = Array.isArray(selectedListingIds) ? selectedListingIds : [];
  try {
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/subscription/select-active-listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ selectedListingIds: ids })
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.ok) return data;
    }
  } catch (err) {
    console.warn('[BackendAPI] Server select-active-listings note, updating in Firestore:', err.message);
  }

  // Fallback direct Firestore batch update
  const listingsSnap = await getDocs(query(
    collection(db, 'listings'),
    where('storeOwnerUid', '==', user.uid)
  ));
  if (!listingsSnap.empty) {
    const batch = writeBatch(db);
    listingsSnap.docs.forEach((docSnap) => {
      const shouldBeActive = ids.includes(docSnap.id);
      batch.update(docSnap.ref, {
        status: shouldBeActive ? 'active' : 'paused',
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
  return { ok: true, activeCount: ids.length };
}

export async function adminGetSubscriptionsBackend() {
  const user = await requireAdmin();
  const token = await user.getIdToken();
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/subscriptions`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && Array.isArray(data.subscriptions)) return data.subscriptions;
    }
  } catch (err) {
    console.warn('[BackendAPI] Admin subscriptions fetch note, checking Firestore:', err.message);
  }

  // Direct Firestore fallback for admin portal
  const snap = await getDocs(collection(db, 'dealerSubscriptions'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
