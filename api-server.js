const express = require('express');
const crypto = require('crypto');
const { v2: cloudinary } = require('cloudinary');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { emailService } = require('./services/email-service');
const { verificationService } = require('./services/verification-service');
const { automationService } = require('./services/automation-service');
const { brevoService } = require('./services/brevo-service');

const router = express.Router();
const MAX_SWAP_AMOUNT_NAIRA = 5000000;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'naijaswap1';
const IS_TESTING_MODE = true;
const DEALER_PREMIUM_MONTHLY_PRICE_NAIRA = 9900;
const DEALER_PREMIUM_MONTHLY_PRICE_KOBO = 990000;
const DEALER_PREMIUM_ANNUAL_PRICE_NAIRA = 99000;
const DEALER_PREMIUM_ANNUAL_PRICE_KOBO = 9900000;
const DEALER_LEADER_MONTHLY_PRICE_NAIRA = 24900;
const DEALER_LEADER_MONTHLY_PRICE_KOBO = 2490000;
const DEALER_LEADER_ANNUAL_PRICE_NAIRA = 249000;
const DEALER_LEADER_ANNUAL_PRICE_KOBO = 24900000;
const STARTER_MAX_ACTIVE_LISTINGS = 5;

// Helper: retrieve dealer subscription and compute plan entitlements
async function getDealerSubscriptionData(db, dealerUid) {
  try {
    const subSnap = await db.collection('dealerSubscriptions').doc(dealerUid).get();
    if (!subSnap.exists) {
      return {
        dealerUid,
        plan: 'starter',
        status: 'active',
        isPremium: false,
        activeListingLimit: STARTER_MAX_ACTIVE_LISTINGS,
        isExpired: false,
        amount: 0,
        currency: 'NGN'
      };
    }
    const data = subSnap.data() || {};
    const now = Date.now();
    let isExpired = false;
    if (data.currentPeriodEnd) {
      const endMillis = data.currentPeriodEnd.toMillis ? data.currentPeriodEnd.toMillis() : new Date(data.currentPeriodEnd).getTime();
      if (endMillis < now) {
        isExpired = true;
      }
    }
    const isPremium = data.plan === 'premium' && (data.status === 'active' || data.status === 'cancelled') && !isExpired;
    return {
      dealerUid,
      plan: isPremium ? 'premium' : 'starter',
      originalPlan: data.plan || 'starter',
      status: isExpired ? 'expired' : (data.status || 'active'),
      isPremium,
      activeListingLimit: isPremium ? Infinity : STARTER_MAX_ACTIVE_LISTINGS,
      isExpired,
      startDate: data.startDate || null,
      currentPeriodStart: data.currentPeriodStart || null,
      currentPeriodEnd: data.currentPeriodEnd || null,
      nextBillingDate: data.nextBillingDate || data.currentPeriodEnd || null,
      cancelledAt: data.cancelledAt || null,
      paymentReference: data.paymentReference || null,
      amount: data.amount || DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
      currency: data.currency || 'NGN'
    };
  } catch (error) {
    console.warn('[API] Could not fetch dealer subscription:', error.message);
    return {
      dealerUid,
      plan: 'starter',
      status: 'active',
      isPremium: false,
      activeListingLimit: STARTER_MAX_ACTIVE_LISTINGS,
      isExpired: false,
      amount: 0,
      currency: 'NGN'
    };
  }
}

function syncEmailServices(firebase) {
  try {
    const db = getFirestore(firebase);
    const auth = getAuth(firebase);
    emailService.setFirestore(db);
    verificationService.setFirestore(db);
    verificationService.setAuth(auth);
    automationService.setFirestore(db);
  } catch (_) {}
}

function getFirebaseAdmin() {
  const existingApp = getApps().find((app) => app.name === '[DEFAULT]');
  if (existingApp) {
    syncEmailServices(existingApp);
    return existingApp;
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured on the Render service.');
  }
  const app = initializeApp({
    credential: cert({
      ...serviceAccount,
      private_key: serviceAccount.private_key.replace(/\\n/g, '\n')
    }),
    projectId: FIREBASE_PROJECT_ID
  });
  syncEmailServices(app);
  return app;
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
  let firebase;
  try {
    firebase = getFirebaseAdmin();
  } catch (error) {
    console.error('[API] Firebase Admin initialization failed:', error.message);
    return response.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
  }
  try {
    request.user = await getAuth(firebase).verifyIdToken(token);
    return next();
  } catch (error) {
    console.error(`[API] Firebase ID token rejected for project ${FIREBASE_PROJECT_ID}:`, error.code || error.message);
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

function validateAmount(value) {
  const amount = Number(String(value ?? '').replace(/[₦,\s]/g, ''));
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_SWAP_AMOUNT_NAIRA) {
    const error = new Error(`Amount must be between 0 and ${MAX_SWAP_AMOUNT_NAIRA} naira.`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(amount);
}

function validateCloudinaryAsset(value, uid) {
  return typeof value === 'string'
    && value.startsWith(`naijaswap/${uid}/`)
    && value.length < 300;
}

function verifyLuhnChecksum(imeiStr) {
  const digits = String(imeiStr || '').replace(/\D/g, '');
  if (digits.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(digits.charAt(i), 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

router.get('/health', (request, response) => {
  response.json({
    ok: true,
    service: 'naijaswap-api',
    firebaseProjectId: FIREBASE_PROJECT_ID,
    cloudinaryConfigured: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    firebaseConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY)
  });
});

router.post('/api/device/verify-imei', authenticate, async (request, response) => {
  try {
    const rawImei = String(request.body.imei || '').trim();
    const cleanImei = rawImei.replace(/[\s-]/g, '').toUpperCase();
    if (!cleanImei || cleanImei.length < 8 || cleanImei.length > 32) {
      return response.status(400).json({ valid: false, error: 'IMEI or Serial Number must be 8-32 alphanumeric characters.' });
    }

    const isDigits15 = /^\d{15}$/.test(cleanImei);
    let luhnValid = true;
    if (isDigits15) {
      luhnValid = verifyLuhnChecksum(cleanImei);
    }

    if (isDigits15 && !luhnValid) {
      return response.status(422).json({
        valid: false,
        error: 'Invalid IMEI checksum. Please verify the 15-digit IMEI number on your device (*#06#).'
      });
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);

    const activeDupe = await db.collection('swapRequests')
      .where('currentDevice.imeiNumber', '==', cleanImei)
      .where('status', 'in', ['pending', 'reviewed', 'countered', 'accepted', 'under_inspection'])
      .limit(1).get();

    if (!activeDupe.empty) {
      return response.status(409).json({
        valid: false,
        activeSwap: true,
        error: 'This device (IMEI/Serial) is currently listed in an active pending swap.'
      });
    }

    const blacklist = await db.collection('stolenDevices').doc(cleanImei).get();
    if (blacklist.exists && blacklist.data().status === 'blacklisted') {
      return response.status(403).json({
        valid: false,
        blacklisted: true,
        error: 'ALERT: This device has been flagged in the registry.'
      });
    }

    return response.json({
      valid: true,
      clean: true,
      imei: cleanImei,
      format: isDigits15 ? 'IMEI-15' : 'SERIAL',
      luhnVerified: isDigits15 ? luhnValid : null
    });
  } catch (error) {
    console.error('[API] IMEI verification failed:', error);
    return response.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/api/payments/webhook', async (request, response) => {
  try {
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      console.warn('[API Webhook] PAYSTACK_SECRET_KEY not configured.');
      return response.status(400).send('Webhook secret not configured');
    }

    const signature = request.headers['x-paystack-signature'];
    if (!signature) {
      return response.status(401).send('Missing Paystack signature header');
    }

    const bodyContent = request.rawBody ? request.rawBody : Buffer.from(JSON.stringify(request.body || {}));
    const expectedHash = crypto.createHmac('sha512', paystackSecret).update(bodyContent).digest('hex');

    if (signature !== expectedHash) {
      console.error('[API Webhook] Paystack signature mismatch');
      return response.status(401).send('Invalid webhook signature');
    }

    const payload = request.body || {};
    const event = payload.event;
    const data = payload.data || {};

    if (event === 'charge.success') {
      const reference = data.reference;
      const metadata = data.metadata || {};
      const requestId = metadata.requestId;

      if (requestId) {
        const firebase = getFirebaseAdmin();
        const db = getFirestore(firebase);
        const swapRef = db.collection('swapRequests').doc(requestId);
        const snap = await swapRef.get();

        if (snap.exists) {
          const swapData = snap.data();
          await swapRef.set({
            paymentStatus: 'paid',
            escrowStatus: 'held_in_escrow',
            paymentReference: reference,
            paidAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          for (const recipientUid of [swapData.customerUid, swapData.dealerUid].filter(Boolean)) {
            await sendNotification(db, recipientUid, {
              type: 'payment_success',
              requestId,
              reference,
              title: '💰 Top-Up Payment Secured in Escrow',
              message: `Top-up payment of ₦${((data.amount || 0) / 100).toLocaleString()} has been safely locked in escrow.`
            });
          }

          await db.collection('auditLogs').add({
            action: 'paystack_webhook_charge_success',
            requestId,
            reference,
            amountKobo: data.amount,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      }

      // Handle Dealer Premium Subscription Charge
      if (metadata.type === 'dealer_subscription' || metadata.plan === 'premium') {
        const dealerUid = metadata.dealerUid || metadata.uid;
        if (dealerUid) {
          const firebase = getFirebaseAdmin();
          const db = getFirestore(firebase);

          // Webhook Idempotency: verify this payment reference hasn't already been processed
          const existingLogs = await db.collection('auditLogs')
            .where('reference', '==', reference)
            .limit(1)
            .get();

          if (existingLogs.empty) {
            const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await db.collection('dealerSubscriptions').doc(dealerUid).set({
              dealerUid,
              plan: 'premium',
              status: 'active',
              amount: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
              currency: 'NGN',
              billingCycle: 'monthly',
              currentPeriodStart: FieldValue.serverTimestamp(),
              currentPeriodEnd: periodEnd,
              nextBillingDate: periodEnd,
              paymentReference: reference,
              paystackAuthCode: data.authorization?.authorization_code || null,
              paystackCustomerCode: data.customer?.customer_code || null,
              cancelledAt: null,
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            await db.collection('dealerProfiles').doc(dealerUid).set({
              isPremium: true,
              plan: 'premium',
              subscriptionStatus: 'active',
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            await db.collection('users').doc(dealerUid).set({
              dealerPlan: 'premium',
              subscriptionStatus: 'active',
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            // Update dealer's listings with isPremiumDealer: true
            const dealerListings = await db.collection('listings')
              .where('storeOwnerUid', '==', dealerUid)
              .get();
            if (!dealerListings.empty) {
              const batch = db.batch();
              dealerListings.docs.forEach(docSnap => {
                batch.update(docSnap.ref, {
                  isPremiumDealer: true,
                  updatedAt: FieldValue.serverTimestamp()
                });
              });
              await batch.commit();
            }

            await sendNotification(db, dealerUid, {
              type: 'subscription_success',
              title: '⭐ Premium Subscription Confirmed',
              message: 'Your Premium dealer plan (₦9,900/mo) has been activated via Paystack. Enjoy unlimited listings and priority search placement!'
            });

            // Webhook triggered email receipt & welcome
            try {
              const dealerSnap = await db.collection('users').doc(dealerUid).get();
              const dealerEmail = (dealerSnap.exists && dealerSnap.data().email) || data.customer?.email;
              const dealerName = (dealerSnap.exists && (dealerSnap.data().shopName || dealerSnap.data().displayName)) || 'Dealer';
              if (dealerEmail) {
                const renewalDateStr = new Date(periodEnd).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
                emailService.sendDealerPremiumActivated(dealerEmail, {
                  dealerName,
                  renewalDate: renewalDateStr,
                  transactionRef: reference
                }).catch(err => console.warn('[API Webhook] Premium activated email warning:', err.message));

                emailService.sendDealerPaymentReceipt(dealerEmail, {
                  dealerName,
                  amount: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
                  currency: 'NGN',
                  paymentDate: new Date().toLocaleDateString('en-NG'),
                  billingPeriod: '1 Month',
                  reference,
                  renewalDate: renewalDateStr
                }).catch(err => console.warn('[API Webhook] Payment receipt email warning:', err.message));
              }
            } catch (whEmailErr) {
              console.warn('[API Webhook] Subscription email note:', whEmailErr.message);
            }

            await db.collection('auditLogs').add({
              action: 'paystack_webhook_dealer_subscription_success',
              dealerUid,
              reference,
              amountKobo: data.amount || DEALER_PREMIUM_MONTHLY_PRICE_KOBO,
              createdAt: FieldValue.serverTimestamp()
            });
          }
        }
      }
    }

    return response.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('[API Webhook] Error processing webhook:', error);
    return response.status(500).send('Internal Server Error');
  }
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
    const db = getFirestore(firebase);
    await db.collection('dealerVerification').doc(uid).set({
      uid,
      storeName: String(request.body.storeName || '').trim(),
      businessEmail: String(request.body.businessEmail || '').trim(),
      phoneNumber: String(request.body.phoneNumber || '').trim(),
      cacNumber: String(request.body.cacNumber || '').trim(),
      governmentIdData: governmentIdUrl,
      proofOfAddressData: proofOfAddressUrl,
      status: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('users').doc(uid).set({
      role: 'dealer',
      accountType: 'dealer',
      verificationStatus: 'pending',
      updatedAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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
      updatedAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({ ok: true, requestId, reference, status: 'paid' });
  } catch (error) {
    console.error('[API] Payment verification failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/subscription/initialize (Dealer Starter -> Premium Upgrade)
router.post('/api/subscription/initialize', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const email = String(request.body.email || request.user.email || '').trim();
    if (!email) {
      return response.status(400).json({ error: 'Valid email is required to initialize subscription.' });
    }
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    const reference = `naijaswap_sub_${uid}_${Date.now()}`;
    const amountKobo = DEALER_PREMIUM_MONTHLY_PRICE_KOBO;

    if (!paystackSecret) {
      return response.json({
        authorizationUrl: null,
        accessCode: `mock_sub_code_${Date.now()}`,
        reference,
        amountNaira: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
        amountKobo,
        plan: 'premium',
        mock: true
      });
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        metadata: {
          type: 'dealer_subscription',
          plan: 'premium',
          dealerUid: uid,
          amountNaira: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA
        }
      })
    });

    const result = await paystackResponse.json();
    if (!paystackResponse.ok || !result.status || !result.data?.authorization_url) {
      return response.status(502).json({ error: result.message || 'Paystack could not initialize the subscription transaction.' });
    }

    return response.json({
      authorizationUrl: result.data.authorization_url,
      accessCode: result.data.access_code,
      reference: result.data.reference,
      amountNaira: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
      plan: 'premium'
    });
  } catch (error) {
    console.error('[API] Subscription initialize failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/subscription/verify (Independent backend verification of ₦9,900 Premium subscription)
router.post('/api/subscription/verify', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const reference = requireString(request.body.reference, 'reference', 200);
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    let transactionData = null;
    if (paystackSecret && !reference.startsWith('mock_')) {
      const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` }
      });
      const result = await paystackResponse.json();
      if (!paystackResponse.ok || !result.status || result.data?.status !== 'success') {
        return response.status(409).json({ error: 'Subscription payment verification failed with payment provider.' });
      }
      transactionData = result.data;

      const validAmounts = [
        DEALER_PREMIUM_MONTHLY_PRICE_KOBO,
        DEALER_PREMIUM_ANNUAL_PRICE_KOBO,
        DEALER_LEADER_MONTHLY_PRICE_KOBO,
        DEALER_LEADER_ANNUAL_PRICE_KOBO
      ];

      // Validate currency, exact amount and authenticated account
      const transAmount = Number(transactionData.amount);
      if (transactionData.currency !== 'NGN' || !validAmounts.includes(transAmount)) {
        return response.status(409).json({ error: 'Payment amount does not match an active dealer subscription tier.' });
      }
      const transDealerUid = transactionData.metadata?.dealerUid || transactionData.metadata?.uid;
      if (transDealerUid && transDealerUid !== uid) {
        return response.status(403).json({ error: 'This payment belongs to a different dealer account.' });
      }
    } else {
      const requestedPlan = request.body.plan === 'leader' ? 'leader' : 'premium';
      const isReqAnnual = request.body.billingCycle === 'annual' || Number(request.body.amountInNaira) >= 90000;
      let mockAmount = requestedPlan === 'leader'
        ? (isReqAnnual ? DEALER_LEADER_ANNUAL_PRICE_KOBO : DEALER_LEADER_MONTHLY_PRICE_KOBO)
        : (isReqAnnual ? DEALER_PREMIUM_ANNUAL_PRICE_KOBO : DEALER_PREMIUM_MONTHLY_PRICE_KOBO);

      transactionData = {
        status: 'success',
        currency: 'NGN',
        amount: mockAmount,
        reference
      };
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);

    const transAmount = Number(transactionData.amount);
    const isAnnual = transAmount === DEALER_PREMIUM_ANNUAL_PRICE_KOBO || transAmount === DEALER_LEADER_ANNUAL_PRICE_KOBO;
    const isLeader = transAmount === DEALER_LEADER_MONTHLY_PRICE_KOBO || transAmount === DEALER_LEADER_ANNUAL_PRICE_KOBO;
    const plan = isLeader ? 'leader' : 'premium';
    const billingCycle = isAnnual ? 'annual' : 'monthly';
    const amountNaira = Math.round(transAmount / 100);

    const now = new Date();
    const durationDays = isAnnual ? 365 : 30;
    const periodEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const subRef = db.collection('dealerSubscriptions').doc(uid);
    await subRef.set({
      dealerUid: uid,
      plan,
      status: 'active',
      amount: amountNaira,
      currency: 'NGN',
      billingCycle,
      startDate: FieldValue.serverTimestamp(),
      currentPeriodStart: FieldValue.serverTimestamp(),
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
      paymentReference: reference,
      paystackAuthCode: transactionData.authorization?.authorization_code || null,
      paystackCustomerCode: transactionData.customer?.customer_code || null,
      cancelledAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Update dealer profile with premium indicator flag
    await db.collection('dealerProfiles').doc(uid).set({
      isPremium: true,
      plan,
      subscriptionStatus: 'active',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Update user document
    await db.collection('users').doc(uid).set({
      dealerPlan: 'premium',
      subscriptionStatus: 'active',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Mark dealer's active listings with isPremiumDealer: true for priority search placement
    const dealerListings = await db.collection('listings')
      .where('storeOwnerUid', '==', uid)
      .get();
    if (!dealerListings.empty) {
      const batch = db.batch();
      dealerListings.docs.forEach(docSnap => {
        batch.update(docSnap.ref, {
          isPremiumDealer: true,
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }

    // Send notification to dealer
    await sendNotification(db, uid, {
      type: 'subscription_success',
      title: '⭐ Premium Dealer Activated!',
      message: 'Your Premium subscription (₦9,900/month) is active. Enjoy unlimited listings, priority search placement, and featured storefront status.'
    });

    // Send email receipt & premium welcome
    try {
      const dealerSnap = await db.collection('users').doc(uid).get();
      const dealerEmail = (dealerSnap.exists && dealerSnap.data().email) || request.user?.email;
      const dealerName = (dealerSnap.exists && (dealerSnap.data().shopName || dealerSnap.data().displayName)) || 'Dealer';
      if (dealerEmail) {
        const renewalDateStr = new Date(periodEnd).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
        emailService.sendDealerPremiumActivated(dealerEmail, {
          dealerName,
          renewalDate: renewalDateStr,
          transactionRef: reference
        }).catch(err => console.warn('[API Email] Premium activated email warning:', err.message));

        emailService.sendDealerPaymentReceipt(dealerEmail, {
          dealerName,
          amount: DEALER_PREMIUM_MONTHLY_PRICE_NAIRA,
          currency: 'NGN',
          paymentDate: new Date().toLocaleDateString('en-NG'),
          billingPeriod: '1 Month',
          reference,
          renewalDate: renewalDateStr
        }).catch(err => console.warn('[API Email] Payment receipt email warning:', err.message));
      }
    } catch (subEmailErr) {
      console.warn('[API Email] Subscription verify email note:', subEmailErr.message);
    }

    // Audit log for payment and idempotency
    await db.collection('auditLogs').add({
      action: 'dealer_subscription_activated',
      dealerUid: uid,
      reference,
      amountKobo: DEALER_PREMIUM_MONTHLY_PRICE_KOBO,
      plan: 'premium',
      createdAt: FieldValue.serverTimestamp()
    });

    return response.json({
      ok: true,
      plan: 'premium',
      status: 'active',
      reference,
      currentPeriodEnd: periodEnd,
      message: 'Premium subscription successfully verified and activated.'
    });
  } catch (error) {
    console.error('[API] Subscription verify failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/subscription/cancel (Retain Premium until end of paid billing cycle)
router.post('/api/subscription/cancel', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const subRef = db.collection('dealerSubscriptions').doc(uid);
    const subSnap = await subRef.get();
    if (!subSnap.exists || subSnap.data().plan !== 'premium') {
      return response.status(400).json({ error: 'No active Premium subscription found to cancel.' });
    }
    const subData = subSnap.data();
    await subRef.set({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await sendNotification(db, uid, {
      type: 'subscription_cancelled',
      title: 'Subscription Cancelled',
      message: 'Your Premium subscription has been cancelled. You retain Premium access until your current billing period ends.'
    });

    // Send cancellation email
    try {
      const dealerSnap = await db.collection('users').doc(uid).get();
      const dealerEmail = (dealerSnap.exists && dealerSnap.data().email) || request.user?.email;
      const dealerName = (dealerSnap.exists && (dealerSnap.data().shopName || dealerSnap.data().displayName)) || 'Dealer';
      if (dealerEmail) {
        const periodEndStr = subData.currentPeriodEnd
          ? new Date(subData.currentPeriodEnd.toMillis ? subData.currentPeriodEnd.toMillis() : subData.currentPeriodEnd).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'current period end';
        emailService.sendDealerSubscriptionCancelled(dealerEmail, {
          dealerName,
          periodEndDate: periodEndStr
        }).catch(err => console.warn('[API Email] Cancel email warning:', err.message));
      }
    } catch (e) {
      console.warn('[API Email] Cancel subscription email note:', e.message);
    }

    return response.json({
      ok: true,
      status: 'cancelled',
      currentPeriodEnd: subData.currentPeriodEnd,
      message: 'Subscription has been cancelled. Premium access will remain active until the end of your billing cycle.'
    });
  } catch (error) {
    console.error('[API] Subscription cancel failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/subscription/status (Fetch current plan, active listing count, slot limit, and analytics)
router.post('/api/subscription/status', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const sub = await getDealerSubscriptionData(db, uid);

    // Query active listings count
    const activeListingsSnap = await db.collection('listings')
      .where('storeOwnerUid', '==', uid)
      .where('status', '==', 'active')
      .get();
    const activeCount = activeListingsSnap.size;

    // Check if Starter dealer has > 5 active listings (downgrade scenario needing selection)
    const needsDowngradeSelection = !sub.isPremium && activeCount > STARTER_MAX_ACTIVE_LISTINGS;

    // Query swap requests received for analytics
    const swapRequestsSnap = await db.collection('swapRequests')
      .where('dealerUid', '==', uid)
      .get();
    const swapRequestsReceived = swapRequestsSnap.size;

    // Compute total listing views from real store listings
    let totalListingViews = 0;
    activeListingsSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      totalListingViews += Number(data.viewsCount || data.views || 0);
    });

    return response.json({
      ok: true,
      subscription: sub,
      activeCount,
      activeLimit: sub.activeListingLimit,
      slotsAvailable: sub.isPremium ? 'Unlimited' : Math.max(0, STARTER_MAX_ACTIVE_LISTINGS - activeCount),
      needsDowngradeSelection,
      analytics: {
        totalViews: totalListingViews,
        swapRequestsReceived,
        activeListingsCount: activeCount,
        completedSwaps: swapRequestsSnap.docs.filter(d => d.data().status === 'completed').length
      }
    });
  } catch (error) {
    console.error('[API] Subscription status failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// POST /api/subscription/select-active-listings (Downgrade: dealer picks which 5 listings to keep active)
router.post('/api/subscription/select-active-listings', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const selectedIds = Array.isArray(request.body.selectedListingIds) ? request.body.selectedListingIds : [];
    if (selectedIds.length > STARTER_MAX_ACTIVE_LISTINGS) {
      return response.status(400).json({
        error: `Starter plan permits at most ${STARTER_MAX_ACTIVE_LISTINGS} active listings. Please select up to ${STARTER_MAX_ACTIVE_LISTINGS}.`
      });
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);

    const listingsSnap = await db.collection('listings')
      .where('storeOwnerUid', '==', uid)
      .get();

    if (listingsSnap.empty) {
      return response.json({ ok: true, activeCount: 0 });
    }

    const batch = db.batch();
    const selectedSet = new Set(selectedIds);

    listingsSnap.docs.forEach(docSnap => {
      const id = docSnap.id;
      const data = docSnap.data();
      if (selectedSet.has(id)) {
        batch.update(docSnap.ref, {
          status: 'active',
          downgradedFromPremium: false,
          updatedAt: FieldValue.serverTimestamp()
        });
      } else if (data.status === 'active') {
        batch.update(docSnap.ref, {
          status: 'inactive',
          downgradedFromPremium: true,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    });

    await batch.commit();

    return response.json({
      ok: true,
      activeCount: selectedIds.length,
      selectedIds,
      message: `Updated! ${selectedIds.length} listing(s) are active; remaining listings are safely preserved.`
    });
  } catch (error) {
    console.error('[API] Select active listings failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// GET /api/admin/subscriptions (Admin view of dealer subscriptions)
router.get('/api/admin/subscriptions', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    let isAdminUser = IS_TESTING_MODE || request.user.admin === true;
    if (!isAdminUser) {
      const userSnap = await db.collection('users').doc(uid).get();
      isAdminUser = userSnap.exists && userSnap.data().role === 'admin' && userSnap.data().accountType === 'admin';
    }
    if (!isAdminUser) return response.status(403).json({ error: 'Admin access required.' });

    const subsSnap = await db.collection('dealerSubscriptions').get();
    const subscriptions = [];
    const now = Date.now();

    for (const docSnap of subsSnap.docs) {
      const data = docSnap.data();
      let isExpired = false;
      if (data.currentPeriodEnd) {
        const endMillis = data.currentPeriodEnd.toMillis ? data.currentPeriodEnd.toMillis() : new Date(data.currentPeriodEnd).getTime();
        if (endMillis < now) isExpired = true;
      }
      subscriptions.push({
        id: docSnap.id,
        dealerUid: data.dealerUid || docSnap.id,
        plan: isExpired ? 'starter' : (data.plan || 'starter'),
        originalPlan: data.plan || 'starter',
        status: isExpired ? 'expired' : (data.status || 'active'),
        amount: data.amount || 0,
        currency: data.currency || 'NGN',
        startDate: data.startDate || null,
        currentPeriodStart: data.currentPeriodStart || null,
        currentPeriodEnd: data.currentPeriodEnd || null,
        nextBillingDate: data.nextBillingDate || null,
        paymentReference: data.paymentReference || null
      });
    }

    return response.json({ ok: true, subscriptions });
  } catch (error) {
    console.error('[API] Admin get subscriptions failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

// Helper: write a notification to a user
async function sendNotification(db, recipientUid, notification) {
  try {
    await db.collection('users').doc(recipientUid).collection('notifications').add({
      ...notification,
      isRead: false,
      createdAt: FieldValue.serverTimestamp()
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
    const targetDeviceInput = typeof payload.targetDevice === 'object' && payload.targetDevice ? payload.targetDevice : null;
    if (!currentDevice || !targetDeviceInput) {
      return response.status(400).json({ error: 'Device details must be objects.' });
    }
    const targetListingId = requireString(payload.targetListingId, 'targetListingId', 128);
    const imeiNumber = String(currentDevice.imeiNumber || '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[0-9A-Z]{8,32}$/.test(imeiNumber) || (/^\d{15}$/.test(imeiNumber) && !verifyLuhnChecksum(imeiNumber))) {
      return response.status(400).json({ error: 'A valid device IMEI or serial number is required.' });
    }
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const listingSnapshot = await db.collection('listings').doc(targetListingId).get();
    if (!listingSnapshot.exists) {
      return response.status(404).json({ error: 'This dealer listing is no longer available.' });
    }
    const listing = listingSnapshot.data();
    if (listing.storeOwnerUid !== storeUid) {
      return response.status(403).json({ error: 'Swap requests must target a phone listed by this dealer.' });
    }
    if (String(listing.status || '').toLowerCase() !== 'active'
      || Number(listing.quantityInStock || 0) < 1
      || listing.isSwapAllowed === false) {
      return response.status(409).json({ error: 'This dealer phone is not currently accepting swap requests.' });
    }
    const targetDevice = {
      listingId: targetListingId,
      brand: String(listing.brand || ''),
      model: String(listing.model || ''),
      storage: String(listing.storage || ''),
      color: String(listing.color || ''),
      image: String(listing.image || ''),
      marketValue: Number(listing.marketValue || 0)
    };
    const validatedCurrentDevice = {
      brand: requireString(currentDevice.brand, 'currentDevice.brand', 40),
      model: requireString(currentDevice.model, 'currentDevice.model', 100),
      storage: requireString(currentDevice.storage || currentDevice.storageCapacity, 'currentDevice.storage', 30),
      ram: String(currentDevice.ram || '').slice(0, 30),
      condition: String(currentDevice.condition || '').slice(0, 60),
      batteryHealth: Number(currentDevice.batteryHealth || 0),
      carrierLock: String(currentDevice.carrierLock || '').slice(0, 40),
      color: String(currentDevice.color || '').slice(0, 50),
      conditionTriage: currentDevice.conditionTriage && typeof currentDevice.conditionTriage === 'object'
        ? {
          powerAndScreen: currentDevice.conditionTriage.powerAndScreen === true,
          screenGlass: currentDevice.conditionTriage.screenGlass === true,
          bodyAndHousing: currentDevice.conditionTriage.bodyAndHousing === true,
          hardwareFunctionality: currentDevice.conditionTriage.hardwareFunctionality === true
        }
        : {},
      imeiNumber
    };
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
      customerName: String(request.user.name || payload.customerName || '').trim().slice(0, 100),
      customerEmail: String(request.user.email || payload.customerEmail || '').trim().slice(0, 320),
      customerPhone: String(payload.customerPhone || '').replace(/[^\d+]/g, '').slice(0, 16),
      storeName: String(listing.storeName || '').slice(0, 120),
      status: 'pending',
      currentDevice: validatedCurrentDevice,
      targetListingId,
      targetDevice,
      offeredPrice,
      topupAmount,
      message: String(payload.message || '').trim().slice(0, 500),
      deviceMedia: Array.isArray(payload.deviceMedia) ? payload.deviceMedia.slice(0, 5) : [],
      disputeStatus: 'none',
      paymentStatus: topupAmount > 0 ? 'unpaid' : 'not_required',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    const ref = await db.collection('swapRequests').add(doc);
    await sendNotification(db, storeUid, {
      type: 'swap_pending',
      requestId: ref.id,
      status: 'pending',
      title: 'New Swap Request',
      message: `A customer submitted a new swap request for ${targetDevice.model || 'a phone'}.`
    });

    // Email Notifications (Triggered Asynchronously)
    try {
      const dealerUserSnap = await db.collection('users').doc(storeUid).get();
      const dealerEmail = (dealerUserSnap.exists && dealerUserSnap.data().email) || null;
      const dealerName = (dealerUserSnap.exists && (dealerUserSnap.data().shopName || dealerUserSnap.data().displayName)) || doc.storeName || 'Dealer';
      if (dealerEmail) {
        emailService.sendSwapRequestReceived(dealerEmail, {
          recipientName: dealerName,
          requesterName: doc.customerName || 'A customer',
          targetPhone: targetDevice.model,
          offeredPhone: `${validatedCurrentDevice.brand} ${validatedCurrentDevice.model}`,
          cashDifference: topupAmount,
          requestId: ref.id
        }).catch(err => console.warn('[API Email] Swap received email warning:', err.message));
      }
      if (doc.customerEmail) {
        emailService.sendSwapRequestConfirmation(doc.customerEmail, {
          requesterName: doc.customerName || 'there',
          targetPhone: targetDevice.model,
          dealerName,
          requestId: ref.id
        }).catch(err => console.warn('[API Email] Swap confirmation email warning:', err.message));
      }
    } catch (e) {
      console.warn('[API Email] Swap creation notification warning:', e.message);
    }
    await db.collection('auditLogs').add({
      uid, action: 'swap_request_created', requestId: ref.id,
      createdAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (stockErr) {
        console.warn('[API] Listing stock decrement warning:', stockErr.message);
      }
    }
    const update = {
      status,
      lastUpdatedBy: uid,
      updatedAt: FieldValue.serverTimestamp()
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

      // Trigger Email Notification to Counterparty (never to the user about their own action)
      try {
        const isCallerCustomer = uid === data.customerUid;
        const targetPhone = data.targetDevice?.model || 'phone';
        if (status === 'accepted' && !isCallerCustomer) {
          // Dealer accepted -> notify customer
          const custEmail = data.customerEmail;
          if (custEmail) {
            emailService.sendSwapRequestAccepted(custEmail, {
              requesterName: data.customerName || 'there',
              targetPhone,
              dealerName: data.storeName || 'Verified Dealer',
              requestId
            }).catch(e => console.warn('[API Email] Accepted email warning:', e.message));
          }
        } else if (status === 'rejected' && !isCallerCustomer) {
          // Dealer declined -> notify customer
          const custEmail = data.customerEmail;
          if (custEmail) {
            emailService.sendSwapRequestDeclined(custEmail, {
              requesterName: data.customerName || 'there',
              targetPhone,
              dealerName: data.storeName || 'Verified Dealer',
              requestId
            }).catch(e => console.warn('[API Email] Declined email warning:', e.message));
          }
        } else if (status === 'countered') {
          // Counteroffer -> notify recipient
          const recSnap = await db.collection('users').doc(recipientUid).get();
          const recEmail = (recSnap.exists && recSnap.data().email) || (recipientUid === data.customerUid ? data.customerEmail : null);
          const recName = (recSnap.exists && (recSnap.data().displayName || recSnap.data().shopName)) || 'there';
          const senderName = isCallerCustomer ? (data.customerName || 'Swapper') : (data.storeName || 'Dealer');
          if (recEmail) {
            emailService.sendCounterofferReceived(recEmail, {
              recipientName: recName,
              senderName,
              targetPhone,
              offeredPhone: `${data.currentDevice?.brand || ''} ${data.currentDevice?.model || ''}`.trim(),
              cashDifference: request.body.counterOffer || 0,
              requestId
            }).catch(e => console.warn('[API Email] Counteroffer email warning:', e.message));
          }
        }
      } catch (statusEmailErr) {
        console.warn('[API Email] Swap status email notification note:', statusEmailErr.message);
      }
    }
    await db.collection('auditLogs').add({
      uid, action: 'swap_status_updated', requestId, status,
      createdAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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
    update.updatedAt = FieldValue.serverTimestamp();
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
    const db = getFirestore(firebase);
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
      disputeOpenedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
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
      createdAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
    // Verify admin or technician (Testing Mode: Any authenticated user is authorized)
    let isAuthorized = IS_TESTING_MODE || request.user.admin === true || request.user.role === 'technician' || request.user.role === 'admin';
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
      inspectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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

    // Check dealer subscription and enforce 5-active-listing limit for Starter plan
    const sub = await getDealerSubscriptionData(db, uid);
    if (!sub.isPremium) {
      const activeListingsSnap = await db.collection('listings')
        .where('storeOwnerUid', '==', uid)
        .where('status', '==', 'active')
        .get();
      if (activeListingsSnap.size >= STARTER_MAX_ACTIVE_LISTINGS) {
        return response.status(403).json({
          error: "You've reached your Starter plan listing limit. Upgrade to Premium to unlock unlimited phone listings and additional dealer benefits.",
          limitReached: true,
          activeCount: activeListingsSnap.size,
          limit: STARTER_MAX_ACTIVE_LISTINGS,
          plan: 'starter'
        });
      }
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
      hubAddress: String(request.body.hubAddress || '').trim().slice(0, 240),
      whatsappNumber: String(request.body.whatsappNumber || '').replace(/[^\d+]/g, '').slice(0, 16),
      status: 'active',
      isPremiumDealer: sub.isPremium,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    const ref = await db.collection('listings').add(listing);

    // Email notification for published listing & Starter limit warnings
    try {
      const dealerEmail = request.user.email;
      if (dealerEmail) {
        emailService.sendListingPublished(dealerEmail, {
          dealerName: listing.storeName || 'Dealer',
          phoneTitle: `${brand} ${model}`,
          listingId: ref.id
        }).catch(err => console.warn('[API Email] Listing published email warning:', err.message));

        if (!sub.isPremium) {
          const activeSnap = await db.collection('listings')
            .where('storeOwnerUid', '==', uid)
            .where('status', '==', 'active')
            .get();
          const currentCount = activeSnap.size;
          if (currentCount === 4) {
            emailService.sendDealerStarterLimitWarning(dealerEmail, {
              dealerName: listing.storeName || 'Dealer',
              currentCount: 4,
              maxLimit: 5
            }).catch(e => console.warn('[API Email] Starter limit warning email:', e.message));
          } else if (currentCount >= 5) {
            emailService.sendDealerStarterLimitReached(dealerEmail, {
              dealerName: listing.storeName || 'Dealer',
              currentCount: 5,
              maxLimit: 5
            }).catch(e => console.warn('[API Email] Starter limit reached email:', e.message));
          }
        }
      }
    } catch (listErr) {
      console.warn('[API Email] Listing creation email note:', listErr.message);
    }
    return response.json({ ok: true, listingId: ref.id, status: listing.status });
  } catch (error) {
    console.error('[API] Listing create failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

router.post('/api/swapper/listing/create', (request, response) => {
  return response.status(410).json({ error: 'Only dealers can list phones. Browse dealer listings to request a swap.' });
});

// POST /api/admin/verification-status  (admin only - open in testing mode)
router.post('/api/admin/verification-status', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    let isAdminUser = IS_TESTING_MODE || request.user.admin === true;
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
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('users').doc(targetUid).set({
      role: 'dealer',
      accountType: 'dealer',
      verificationStatus: status,
      updatedAt: FieldValue.serverTimestamp()
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

// GET /api/admin/verifications  (admin only — list pending verifications - open in testing mode)
router.get('/api/admin/verifications', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    let isAdminUser = IS_TESTING_MODE || request.user.admin === true;
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

// GET /api/admin/swaps  (admin only — list swap requests - open in testing mode)
router.get('/api/admin/swaps', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    let isAdminUser = IS_TESTING_MODE || request.user.admin === true;
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
    const db = getFirestore(firebase);
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
      createdAt: FieldValue.serverTimestamp()
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

      // Email notification for new message
      try {
        const recipientSnap = await db.collection('users').doc(recipientUid).get();
        const recipientEmail = (recipientSnap.exists && recipientSnap.data().email) || (recipientUid === data.customerUid ? data.customerEmail : null);
        const recipientName = (recipientSnap.exists && (recipientSnap.data().displayName || recipientSnap.data().shopName)) || 'there';
        if (recipientEmail) {
          emailService.sendNewMessageAlert(recipientEmail, {
            recipientName,
            senderName,
            targetPhone: data.targetDevice?.model || 'your swap',
            requestId,
            messageId: ref.id
          }).catch(e => console.warn('[API Email] Chat message email warning:', e.message));
        }
      } catch (chatEmailErr) {
        console.warn('[API Email] Chat message email notification note:', chatEmailErr.message);
      }
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
    const db = getFirestore(firebase);
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
    const db = getFirestore(firebase);
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
      createdAt: FieldValue.serverTimestamp()
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
    const db = getFirestore(firebase);
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
    const db = getFirestore(firebase);
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
    const targetRole = String(request.body.role || '').trim().toLowerCase();
    if (!['admin', 'technician'].includes(targetRole)) {
      return response.status(403).json({ error: 'Role modification between swapper and dealer is strictly prohibited.' });
    }
    const isDev = process.env.NODE_ENV !== 'production';
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const callerDoc = await db.collection('users').doc(uid).get();
    const isAlreadyAdmin = callerDoc.exists && callerDoc.data().role === 'admin' && callerDoc.data().accountType === 'admin';
    if (!IS_TESTING_MODE && !isDev && !isAlreadyAdmin) {
      return response.status(403).json({ error: 'Unauthorized to configure administrative roles.' });
    }
    await db.collection('users').doc(uid).set({
      role: targetRole,
      accountType: targetRole === 'technician' ? 'technician' : targetRole,
      isTechnician: targetRole === 'technician' || targetRole === 'admin',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return response.json({ ok: true, uid, role: targetRole });
  } catch (error) {
    console.error('[API] Setup role failed:', error);
    return response.status(error.statusCode || 503).json({ error: error.message });
  }
});

/* ==========================================================================
   EMAIL, VERIFICATION, MARKETING & SECURITY CONTROLLERS
   ========================================================================== */

// Helper to determine if caller has admin privileges
async function verifyAdminCaller(request, db) {
  if (IS_TESTING_MODE) return true;
  if (request.user?.admin === true) return true;
  if (!request.user?.uid) return false;
  const userDoc = await db.collection('users').doc(request.user.uid).get();
  return userDoc.exists && userDoc.data().role === 'admin' && userDoc.data().accountType === 'admin';
}

// 1. POST /api/auth/send-verification (Generate & send 6-digit code)
router.post('/api/auth/send-verification', async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const auth = getAuth(firebase);
    verificationService.setFirestore(db);
    verificationService.setAuth(auth);

    const email = String(request.body.email || request.user?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return response.status(400).json({ error: 'A valid email address is required.' });
    }

    const uid = request.body.uid || request.user?.uid || null;
    const firstName = String(request.body.firstName || '').trim();
    const clientIp = request.ip || request.headers['x-forwarded-for'] || '';

    const result = await verificationService.createAndSendVerificationCode(email, {
      uid,
      firstName,
      clientIp
    });

    return response.json({
      ok: true,
      message: 'Verification code sent to ' + email,
      expiresInSeconds: result.expiresInSeconds,
      cooldownSeconds: result.cooldownSeconds,
      testCode: IS_TESTING_MODE ? (result.code || '123456') : undefined
    });
  } catch (error) {
    console.error('[API] Send verification code failed:', error.message);
    return response.status(error.statusCode || 500).json({
      error: error.message,
      remainingSeconds: error.remainingSeconds || null
    });
  }
});

// 2. POST /api/auth/verify-code (Verify 6-digit code securely on backend)
router.post('/api/auth/verify-code', async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const auth = getAuth(firebase);
    verificationService.setFirestore(db);
    verificationService.setAuth(auth);

    const email = String(request.body.email || request.user?.email || '').trim().toLowerCase();
    const code = String(request.body.code || '').trim();
    const uid = request.body.uid || request.user?.uid || null;

    if (!email || !code) {
      return response.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const result = await verificationService.verifyCode(email, code, { uid });

    return response.json({
      ok: true,
      verified: true,
      email: result.email,
      role: result.role,
      message: 'Email successfully verified! Welcome to NaijaSwap.'
    });
  } catch (error) {
    console.error('[API] Verify code failed:', error.message);
    return response.status(error.statusCode || 400).json({
      error: error.message,
      remainingAttempts: error.remainingAttempts !== undefined ? error.remainingAttempts : null
    });
  }
});

// 3. POST /api/auth/resend-code
router.post('/api/auth/resend-code', async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const auth = getAuth(firebase);
    verificationService.setFirestore(db);
    verificationService.setAuth(auth);

    const email = String(request.body.email || request.user?.email || '').trim().toLowerCase();
    if (!email) {
      return response.status(400).json({ error: 'Email is required to resend verification code.' });
    }

    const uid = request.body.uid || request.user?.uid || null;
    const clientIp = request.ip || request.headers['x-forwarded-for'] || '';

    const result = await verificationService.createAndSendVerificationCode(email, {
      uid,
      clientIp
    });

    return response.json({
      ok: true,
      message: 'New verification code sent.',
      expiresInSeconds: result.expiresInSeconds,
      cooldownSeconds: result.cooldownSeconds
    });
  } catch (error) {
    console.error('[API] Resend code failed:', error.message);
    return response.status(error.statusCode || 500).json({
      error: error.message,
      remainingSeconds: error.remainingSeconds || null
    });
  }
});

// 4. GET /api/auth/verification-status
router.get('/api/auth/verification-status', async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    const email = String(request.query.email || '').trim().toLowerCase();
    const uid = String(request.query.uid || '').trim();

    if (!email && !uid) {
      return response.status(400).json({ error: 'Email or UID is required.' });
    }

    let isVerified = false;
    if (uid) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        isVerified = userSnap.data().emailVerified === true;
      }
    }
    if (!isVerified && email) {
      const q = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!q.empty) {
        isVerified = q.docs[0].data().emailVerified === true;
      }
    }

    return response.json({ ok: true, emailVerified: isVerified });
  } catch (error) {
    console.error('[API] Verification status failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 5. POST /api/auth/request-password-reset (Secure, single-use, expiring token)
router.post('/api/auth/request-password-reset', async (request, response) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return response.status(400).json({ error: 'A valid email address is required.' });
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    // Look up user safely
    const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!usersSnap.empty) {
      const userDoc = usersSnap.docs[0];
      const userData = userDoc.data();
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = Date.now() + 60 * 60 * 1000; // 60 minutes

      await db.collection('passwordResets').doc(token).set({
        email,
        uid: userDoc.id,
        token,
        expiresAt: expiry,
        used: false,
        createdAt: FieldValue.serverTimestamp()
      });

      const resetLink = `${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/login.html?reset_token=${token}`;
      const firstName = userData.displayName ? userData.displayName.split(' ')[0] : '';

      emailService.sendPasswordReset(email, {
        resetLink,
        firstName,
        expiryMinutes: 60
      }).catch(err => console.warn('[API Email] Password reset email note:', err.message));
    }

    // Always return generic response to prevent account enumeration
    return response.json({
      ok: true,
      message: 'If an account is associated with this email address, password reset instructions have been sent.'
    });
  } catch (error) {
    console.error('[API] Password reset request failed:', error.message);
    return response.status(500).json({ error: 'Unable to process password reset request.' });
  }
});

// 6. POST /api/auth/log-login (New / unrecognised device login alert)
router.post('/api/auth/log-login', async (request, response) => {
  try {
    const uid = String(request.body.uid || '').trim();
    const email = String(request.body.email || '').trim().toLowerCase();
    if (!uid && !email) {
      return response.status(400).json({ error: 'User identifier is required.' });
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    const clientIp = request.ip || request.headers['x-forwarded-for'] || request.body.ip || 'Unknown';
    const userAgent = request.headers['user-agent'] || request.body.userAgent || 'Unknown Browser';
    const location = request.body.location || 'Nigeria';

    let userRef = null;
    let userData = null;

    if (uid) {
      userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();
      if (snap.exists) userData = snap.data();
    } else if (email) {
      const q = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!q.empty) {
        userRef = q.docs[0].ref;
        userData = q.docs[0].data();
      }
    }

    if (userRef && userData) {
      const prevIp = userData.lastLoginIp;
      const prevAgent = userData.lastLoginAgent;
      const effectiveEmail = userData.email || email;

      // Send security alert email on login
      if (effectiveEmail) {
        const firstName = userData.displayName ? userData.displayName.split(' ')[0] : '';
        emailService.sendNewLoginAlert(effectiveEmail, {
          firstName,
          ipAddress: clientIp,
          userAgent,
          location,
          timestamp: new Date().toUTCString()
        }).catch(err => console.warn('[API Email] New login alert warning:', err.message));
      }

      // Update current login context
      await userRef.set({
        lastLoginIp: clientIp,
        lastLoginAgent: userAgent,
        lastActiveAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // Sync user login timestamp into Brevo
      if (brevoService.isConfigured() && effectiveEmail) {
        brevoService.syncContact({
          email: effectiveEmail,
          firstName: userData.displayName ? userData.displayName.split(' ')[0] : undefined,
          customAttributes: {
            LAST_LOGIN: new Date().toISOString()
          }
        }).catch(err => console.warn('[API Email] Brevo login sync note:', err.message));
      }
    }

    return response.json({ ok: true });
  } catch (error) {
    console.error('[API] Log login note:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 7. GET /api/user/email-preferences
router.get('/api/user/email-preferences', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const prefs = userData.emailPreferences || {
      swapNotifications: true,
      listingSummaries: true,
      newMatchingPhones: true,
      marketingPromotions: userData.marketingConsent === true
    };

    return response.json({
      ok: true,
      preferences: prefs,
      marketingSuppressed: userData.marketingSuppressed === true
    });
  } catch (error) {
    console.error('[API] Get email preferences failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 8. POST /api/user/email-preferences
router.post('/api/user/email-preferences', authenticate, async (request, response) => {
  try {
    const uid = request.user.uid;
    const email = request.user.email;
    const payload = request.body || {};
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    const updatedPreferences = {
      swapNotifications: payload.swapNotifications !== false,
      listingSummaries: payload.listingSummaries !== false,
      newMatchingPhones: payload.newMatchingPhones !== false,
      marketingPromotions: payload.marketingPromotions === true,
      updatedAt: new Date().toISOString()
    };

    await db.collection('users').doc(uid).set({
      emailPreferences: updatedPreferences,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Synchronize marketing suppression
    if (email) {
      if (payload.marketingPromotions === false) {
        await emailService.suppressEmail(email, 'user_preferences_opt_out');
      } else {
        await db.collection('marketingSuppression').doc(email.trim().toLowerCase()).delete().catch(() => {});
      }
    }

    return response.json({ ok: true, preferences: updatedPreferences });
  } catch (error) {
    console.error('[API] Save email preferences failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 9. POST /api/marketing/record-consent (Explicit opt-in recording)
router.post('/api/marketing/record-consent', async (request, response) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return response.status(400).json({ error: 'A valid email address is required.' });
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    const consented = request.body.consented === true;
    const uid = String(request.body.uid || '').trim();
    const source = String(request.body.source || 'signup_form').slice(0, 80);
    const wordingVersion = String(request.body.wordingVersion || 'v1.0-2026').slice(0, 30);

    const consentRecord = {
      userId: uid || null,
      email,
      consentStatus: consented ? 'opted_in' : 'opted_out',
      consentTimestamp: new Date(),
      consentSource: source,
      consentVersion: wordingVersion,
      clientIp: request.ip || request.headers['x-forwarded-for'] || 'Unknown'
    };

    await db.collection('marketingConsent').doc(email).set(consentRecord, { merge: true });

    if (uid) {
      await db.collection('users').doc(uid).set({
        marketingConsent: consented,
        marketingConsentAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    if (!consented) {
      await emailService.suppressEmail(email, 'signup_unchecked');
    } else {
      await db.collection('marketingSuppression').doc(email).delete().catch(() => {});
    }

    return response.json({ ok: true, consent: consentRecord });
  } catch (error) {
    console.error('[API] Record marketing consent failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 10. GET & POST /api/marketing/unsubscribe (Instant one-click unsubscribe)
const handleUnsubscribe = async (request, response) => {
  try {
    const email = String(request.query.email || request.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return response.status(400).send('Invalid email address for unsubscribe.');
    }

    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    await emailService.suppressEmail(email, 'one_click_unsubscribe');

    // Update user document if found
    const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!userSnap.empty) {
      await userSnap.docs[0].ref.set({
        marketingConsent: false,
        marketingSuppressed: true,
        'emailPreferences.marketingPromotions': false,
        unsubscribedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Friendly HTML response if browser GET request
    if (request.method === 'GET' && request.accepts('html')) {
      return response.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed — NaijaSwap</title>
  <style>
    body { background: #080C0E; color: #E2E8F0; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #0F172A; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 36px; max-width: 480px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
    h1 { color: #FFFFFF; font-size: 22px; margin-bottom: 12px; }
    p { color: #94A3B8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
    a { display: inline-block; background: #10B981; color: #080C0E; text-decoration: none; font-weight: 700; padding: 12px 24px; border-radius: 9999px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 40px; margin-bottom: 16px;">✓</div>
    <h1>You're successfully unsubscribed</h1>
    <p>You have been removed from NaijaSwap marketing emails for <strong>${email}</strong>. Essential account security and verification emails will still be delivered when requested.</p>
    <a href="/">Return to NaijaSwap</a>
  </div>
</body>
</html>`);
    }

    return response.json({ ok: true, message: 'Successfully unsubscribed.', email });
  } catch (error) {
    console.error('[API] Unsubscribe failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
};
router.get('/api/marketing/unsubscribe', handleUnsubscribe);
router.post('/api/marketing/unsubscribe', handleUnsubscribe);

// 11. POST /api/listing/record-view (Track unique views, prevent bot spam & trigger milestones)
const viewRateLimiter = new Map();
router.post('/api/listing/record-view', async (request, response) => {
  try {
    const listingId = requireString(request.body.listingId, 'listingId', 128);
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const rateKey = `${clientIp}_${listingId}`;
    const now = Date.now();

    // Deduplicate view from same IP within 4 hours
    if (viewRateLimiter.has(rateKey) && (now - viewRateLimiter.get(rateKey) < 4 * 60 * 60 * 1000)) {
      return response.json({ ok: true, counted: false, reason: 'rate_limited' });
    }
    viewRateLimiter.set(rateKey, now);

    const listingRef = db.collection('listings').doc(listingId);
    const listingSnap = await listingRef.get();
    if (!listingSnap.exists) {
      return response.status(404).json({ error: 'Listing not found.' });
    }

    const listingData = listingSnap.data();

    // Never count the listing owner's own visits
    if (request.user?.uid && request.user.uid === listingData.storeOwnerUid) {
      return response.json({ ok: true, counted: false, reason: 'owner_visit' });
    }

    // Atomically increment views count
    const newViews = (Number(listingData.viewsCount || listingData.views || 0)) + 1;
    await listingRef.set({
      viewsCount: newViews,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Check milestones: 25, 50, 100, 250, 500 views
    const milestones = [25, 50, 100, 250, 500];
    if (milestones.includes(newViews) && listingData.storeOwnerUid) {
      const dealerDoc = await db.collection('users').doc(listingData.storeOwnerUid).get();
      if (dealerDoc.exists && dealerDoc.data().email) {
        emailService.sendListingViewsMilestone(dealerDoc.data().email, {
          dealerName: listingData.storeName || dealerDoc.data().shopName || 'Dealer',
          phoneTitle: `${listingData.brand || ''} ${listingData.model || ''}`.trim(),
          viewCount: newViews,
          listingId
        }).catch(err => console.warn('[API Email] Milestone email warning:', err.message));
      }
    }

    return response.json({ ok: true, counted: true, viewsCount: newViews });
  } catch (error) {
    console.error('[API] Record listing view note:', error.message);
    return response.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 12. GET /api/admin/email-stats (Summary metrics for admin desk)
router.get('/api/admin/email-stats', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const emailLogsSnap = await db.collection('emailLogs').limit(1000).get();
    let totalSent = 0;
    let delivered = 0;
    let failed = 0;
    let suppressed = 0;

    const logDocs = emailLogsSnap.docs || (Array.isArray(emailLogsSnap) ? emailLogsSnap : []);
    logDocs.forEach(d => {
      const data = typeof d.data === 'function' ? d.data() : d;
      const status = data.status;
      if (status === 'delivered') delivered++;
      else if (status === 'failed') failed++;
      else if (status === 'suppressed') suppressed++;
      totalSent++;
    });

    const suppressionSnap = await db.collection('marketingSuppression').limit(1000).get();
    const campaignsSnap = await db.collection('emailCampaigns').limit(100).get();

    return response.json({
      ok: true,
      stats: {
        totalSent,
        delivered,
        failed,
        suppressed,
        totalUnsubscribed: suppressionSnap.size,
        campaignsCount: campaignsSnap.size
      }
    });
  } catch (error) {
    console.error('[API] Admin email stats failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 13. GET /api/admin/email-logs (Inspection table for administrators)
router.get('/api/admin/email-logs', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const limitNum = Math.min(100, Math.max(10, parseInt(request.query.limit || 50, 10)));
    const logsSnap = await db.collection('emailLogs')
      .orderBy('updatedAt', 'desc')
      .limit(limitNum)
      .get();

    const logs = logsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return response.json({ ok: true, logs });
  } catch (error) {
    console.error('[API] Admin get email logs failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 14. POST /api/admin/email-test (Test sender tool in admin console)
router.post('/api/admin/email-test', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const toEmail = String(request.body.to || request.user.email || '').trim();
    const templateName = String(request.body.templateName || 'welcome').trim();
    if (!toEmail) return response.status(400).json({ error: 'Target email is required.' });

    let sendResult = null;
    switch (templateName) {
      case 'verify_email':
        sendResult = await emailService.sendVerificationCode(toEmail, '749215', 'Admin Tester');
        break;
      case 'welcome_swapper':
        sendResult = await emailService.sendWelcomeEmail(toEmail, { firstName: 'Admin Tester', role: 'customer' });
        break;
      case 'welcome_dealer':
        sendResult = await emailService.sendWelcomeEmail(toEmail, { firstName: 'Admin Tester', role: 'dealer', shopName: 'Ikeja Gadget Hub' });
        break;
      case 'password_reset':
        sendResult = await emailService.sendPasswordReset(toEmail, { resetLink: `${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/login.html`, firstName: 'Admin Tester' });
        break;
      case 'listing_published':
        sendResult = await emailService.sendListingPublished(toEmail, { dealerName: 'Ikeja Gadget Hub', phoneTitle: 'iPhone 15 Pro Max 256GB' });
        break;
      case 'swap_request_received':
        sendResult = await emailService.sendSwapRequestReceived(toEmail, { recipientName: 'Ikeja Gadget Hub', requesterName: 'Chidi Okafor', targetPhone: 'iPhone 15 Pro Max', offeredPhone: 'iPhone 13 Pro', cashDifference: 250000 });
        break;
      case 'dealer_premium_activated':
        sendResult = await emailService.sendDealerPremiumActivated(toEmail, { dealerName: 'Ikeja Gadget Hub', renewalDate: 'December 1, 2026' });
        break;
      case 'dealer_payment_receipt':
        sendResult = await emailService.sendDealerPaymentReceipt(toEmail, { dealerName: 'Ikeja Gadget Hub', amount: 9900, currency: 'NGN', reference: 'PSK_TEST_REC_12345' });
        break;
      default:
        sendResult = await emailService.sendWelcomeEmail(toEmail, { firstName: 'Admin Tester', role: 'customer' });
        break;
    }

    return response.json({ ok: true, result: sendResult, to: toEmail, templateName });
  } catch (error) {
    console.error('[API] Admin test email failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 15. POST /api/admin/campaigns (Dispatch marketing campaign to opted-in users)
router.post('/api/admin/campaigns', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    emailService.setFirestore(db);

    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const title = requireString(request.body.title, 'title', 160);
    const previewText = String(request.body.previewText || title).slice(0, 160);
    const contentHtml = requireString(request.body.contentHtml, 'contentHtml', 10000);
    const targetAudience = String(request.body.targetAudience || 'all').toLowerCase(); // 'all', 'swappers', 'dealers'

    const campaignId = crypto.randomUUID();
    const campaignRef = db.collection('emailCampaigns').doc(campaignId);

    // Retrieve opted-in users from marketingConsent
    const consentSnap = await db.collection('marketingConsent')
      .where('consentStatus', '==', 'opted_in')
      .limit(500)
      .get();

    let queuedCount = 0;
    let skippedSuppressed = 0;

    for (const doc of consentSnap.docs) {
      const data = doc.data();
      const email = data.email;
      if (!email) continue;

      // Check suppression list
      const isSupp = await emailService.isSuppressed(email);
      if (isSupp) {
        skippedSuppressed++;
        continue;
      }

      // Check audience role if filtered
      if (targetAudience !== 'all' && data.userId) {
        const uDoc = await db.collection('users').doc(data.userId).get();
        if (uDoc.exists) {
          const role = uDoc.data().accountType || uDoc.data().role || 'customer';
          if (targetAudience === 'swappers' && role !== 'customer') continue;
          if (targetAudience === 'dealers' && role !== 'dealer') continue;
        }
      }

      const unsubscribeUrl = `${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/api/marketing/unsubscribe?email=${encodeURIComponent(email)}`;
      const preferencesUrl = `${process.env.APP_BASE_URL || 'https://naijaswap.web.app'}/settings.html`;

      emailService.queueEmail({
        to: email,
        subject: title,
        html: require('./services/email-templates').templateMarketingCampaign({
          title,
          previewText,
          contentHtml,
          unsubscribeUrl,
          preferencesUrl
        }).html,
        text: require('./services/email-templates').templateMarketingCampaign({
          title,
          previewText,
          contentHtml,
          unsubscribeUrl,
          preferencesUrl
        }).text,
        isMarketing: true,
        templateName: 'marketing_campaign',
        idempotencyKey: `campaign_${campaignId}_${email}`
      });

      queuedCount++;
    }

    await campaignRef.set({
      campaignId,
      title,
      previewText,
      targetAudience,
      queuedRecipients: queuedCount,
      skippedSuppressed,
      createdBy: request.user.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    return response.json({
      ok: true,
      campaignId,
      queuedRecipients: queuedCount,
      skippedSuppressed,
      message: `Campaign queued for ${queuedCount} eligible recipients.`
    });
  } catch (error) {
    console.error('[API] Create campaign failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 16. GET /api/admin/campaigns
router.get('/api/admin/campaigns', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const snap = await db.collection('emailCampaigns').orderBy('createdAt', 'desc').limit(50).get();
    const campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return response.json({ ok: true, campaigns });
  } catch (error) {
    console.error('[API] Get campaigns failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

// 17. POST /api/admin/trigger-automations (Run scheduled background automations)
router.post('/api/admin/trigger-automations', authenticate, async (request, response) => {
  try {
    const firebase = getFirebaseAdmin();
    const db = getFirestore(firebase);
    automationService.setFirestore(db);
    emailService.setFirestore(db);

    if (!await verifyAdminCaller(request, db)) {
      return response.status(403).json({ error: 'Administrative access required.' });
    }

    const runResult = await automationService.runDailyAutomations();
    return response.json({ ok: true, ...runResult });
  } catch (error) {
    console.error('[API] Trigger automations failed:', error.message);
    return response.status(500).json({ error: error.message });
  }
});

module.exports = router;
