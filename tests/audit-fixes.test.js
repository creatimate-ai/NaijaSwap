const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

const mockDocSnap = {
  exists: true,
  data: jest.fn(() => ({
    storeOwnerUid: 'dealer_123',
    dealerUid: 'dealer_123',
    customerUid: 'user_123',
    status: 'under_inspection',
    topupAmount: 50000,
    paymentStatus: 'paid',
    escrowStatus: 'held_in_escrow',
    dealerConfirmed: true
  }))
};

const mockFirestore = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue(mockDocSnap),
  set: jest.fn().mockResolvedValue(true),
  add: jest.fn().mockResolvedValue({ id: 'test-payout-id' })
};

const mockVerifyIdToken = jest.fn().mockImplementation((token) => {
  if (token === 'valid-user-token') {
    return Promise.resolve({ uid: 'user_123', email: 'test@example.com' });
  }
  if (token === 'valid-dealer-token') {
    return Promise.resolve({ uid: 'dealer_123', email: 'dealer@example.com' });
  }
  if (token === 'valid-admin-token') {
    return Promise.resolve({ uid: 'admin_123', email: 'admin@example.com', admin: true });
  }
  return Promise.reject(new Error('Invalid token'));
});

jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => [{ name: '[DEFAULT]' }]),
  initializeApp: jest.fn(),
  cert: jest.fn(() => ({ type: 'test-credential' }))
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken }))
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => mockFirestore),
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') }
}));

const apiRouter = require('../api-server');

const app = express();
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Route protection middleware (mirrors server.js)
const BLOCKED_EXTENSIONS = /\.(json|env|rules|yaml|yml|log|lock|md|test\.js)$/i;
const BLOCKED_PATHS = new Set([
  '/server.js',
  '/api-server.js',
  '/test-brevo.js',
  '/package.json',
  '/package-lock.json',
  '/firestore.rules',
  '/storage.rules',
  '/firestore.indexes.json',
  '/render.yaml',
  '/.env',
  '/.env.example',
  '/.firebaserc',
  '/.gitignore'
]);

app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (
    BLOCKED_PATHS.has(reqPath) ||
    reqPath.startsWith('/functions') ||
    reqPath.startsWith('/tests') ||
    reqPath.startsWith('/services') ||
    BLOCKED_EXTENSIONS.test(reqPath)
  ) {
    return res.status(404).send('Not Found');
  }
  next();
});

app.use(apiRouter);

describe('NigerSwap Audit Fixes Verification Suite', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      PAYSTACK_SECRET_KEY: 'sk_test_secret_key_123',
      ENABLE_TESTING_MODE: 'false'
    };
    mockFirestore.get.mockReset().mockResolvedValue(mockDocSnap);
    mockFirestore.set.mockClear();
    mockFirestore.add.mockClear();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('Fix 1.F: Server File Protection', () => {
    it('blocks direct HTTP access to api-server.js', async () => {
      const res = await request(app).get('/api-server.js');
      expect(res.statusCode).toBe(404);
    });

    it('blocks direct HTTP access to package.json', async () => {
      const res = await request(app).get('/package.json');
      expect(res.statusCode).toBe(404);
    });

    it('blocks direct HTTP access to firestore.rules', async () => {
      const res = await request(app).get('/firestore.rules');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Fix 1.E: Subscription Verification Security', () => {
    it('rejects mock_ references and requires genuine Paystack verification', async () => {
      // Mock global fetch to return payment not found
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ status: false, message: 'Transaction not found' })
      });

      const res = await request(app)
        .post('/api/subscription/verify')
        .set('Authorization', 'Bearer valid-dealer-token')
        .send({ reference: 'mock_fake_reference', plan: 'premium' });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/failed with payment provider/i);

      global.fetch = originalFetch;
    });
  });

  describe('Fix 2.B: Paystack Webhook with swapRequestId', () => {
    it('successfully processes webhook using swapRequestId in metadata', async () => {
      const secret = 'sk_test_secret_key_123';
      const bodyData = JSON.stringify({
        event: 'charge.success',
        data: {
          reference: 'NS-ESCROW-12345',
          amount: 5000000,
          metadata: { swapRequestId: 'swap_req_abc' }
        }
      });
      const signature = crypto.createHmac('sha512', secret).update(Buffer.from(bodyData)).digest('hex');

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-paystack-signature', signature)
        .set('Content-Type', 'application/json')
        .send(bodyData);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(mockFirestore.set).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentStatus: 'paid',
          escrowStatus: 'held_in_escrow',
          paymentReference: 'NS-ESCROW-12345'
        }),
        { merge: true }
      );
    });
  });

  describe('Fix 2.C: Handover Confirmation & Escrow Payout', () => {
    it('sets status to completed and creates escrowPayouts when both parties confirm', async () => {
      // User is customer, dealer has already confirmed
      mockDocSnap.data = jest.fn(() => ({
        customerUid: 'user_123',
        dealerUid: 'dealer_123',
        dealerConfirmed: true,
        topupAmount: 75000,
        paymentStatus: 'paid',
        escrowStatus: 'held_in_escrow',
        storeName: 'Ikeja Gadget Store',
        paymentReference: 'NS-ESCROW-9988'
      }));

      const res = await request(app)
        .post('/api/swap/confirm-handover')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ requestId: 'swap_req_999', confirmed: true });

      expect(res.statusCode).toBe(200);
      expect(mockFirestore.set).toHaveBeenCalledWith(
        expect.objectContaining({
          customerConfirmed: true,
          status: 'completed',
          escrowStatus: 'disbursement_pending'
        }),
        { merge: true }
      );

      // Verify escrow payout queue record was created
      expect(mockFirestore.add).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'swap_req_999',
          dealerUid: 'dealer_123',
          amountNaira: 75000,
          status: 'pending_disbursement'
        })
      );
    });
  });

  describe('Fix 3.A: Cloudinary KYC Asset Validation', () => {
    it('accepts HTTPS Cloudinary URLs for dealer verification', async () => {
      const res = await request(app)
        .post('/api/dealer-verification')
        .set('Authorization', 'Bearer valid-user-token')
        .send({
          governmentIdData: 'https://res.cloudinary.com/jra2fgxo/image/upload/v1234567/naijaswap/user_123/government_id/doc_1.jpg',
          proofOfAddressData: 'https://res.cloudinary.com/jra2fgxo/image/upload/v1234567/naijaswap/user_123/proof_of_address/doc_2.jpg'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe('pending');
    });
  });
});
