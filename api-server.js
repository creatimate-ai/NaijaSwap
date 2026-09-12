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
    }),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
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
    firebaseConfigured: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_SERVICE_ACCOUNT),
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

module.exports = router;
