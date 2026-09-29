const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

const mockFirestore = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({
    empty: true,
    exists: false,
    docs: []
  }),
  set: jest.fn().mockResolvedValue(true),
  add: jest.fn().mockResolvedValue({ id: 'test-doc-id' })
};

const mockVerifyIdToken = jest.fn().mockImplementation((token) => {
  if (token === 'valid-user-token') {
    return Promise.resolve({ uid: 'user_123', email: 'test@example.com' });
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
const firebaseAdminApp = require('firebase-admin/app');

const app = express();
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(apiRouter);

describe('NaijaSwap API Server Test Suite', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, PAYSTACK_SECRET_KEY: 'sk_test_secret_key_123' };
    mockFirestore.get.mockReset().mockResolvedValue({
      empty: true,
      exists: false,
      docs: []
    });
    mockFirestore.add.mockClear();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('GET /health', () => {
    it('should return service health status and config flags', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.service).toBe('naijaswap-api');
      expect(res.body.firebaseProjectId).toBe('naijaswap1');
      expect(res.body.paystackConfigured).toBe(true);
    });
  });

  describe('Firebase Admin initialization', () => {
    it('initializes credentials with the modular Firebase Admin API', async () => {
      firebaseAdminApp.getApps.mockReturnValueOnce([]);
      firebaseAdminApp.initializeApp.mockReturnValueOnce({ name: '[DEFAULT]' });
      process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
        project_id: 'naijaswap1',
        client_email: 'api@naijaswap1.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      });

      const res = await request(app)
        .post('/api/device/verify-imei')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ imei: '356938035643809' });

      expect(res.statusCode).toBe(200);
      expect(firebaseAdminApp.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'naijaswap1',
        credential: expect.any(Object)
      }));
    });
  });

  describe('POST /api/device/verify-imei', () => {
    it('should reject requests without authentication', async () => {
      const res = await request(app)
        .post('/api/device/verify-imei')
        .send({ imei: '356938035643809' });
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Authentication is required/i);
    });

    it('should validate a correct 15-digit IMEI using Luhn checksum', async () => {
      // 356938035643809 is a valid Luhn 15-digit IMEI
      const res = await request(app)
        .post('/api/device/verify-imei')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ imei: '356938035643809' });

      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.clean).toBe(true);
      expect(res.body.format).toBe('IMEI-15');
      expect(res.body.luhnVerified).toBe(true);
    });

    it('should reject an invalid 15-digit IMEI checksum', async () => {
      // 356938035643808 has an invalid Luhn check digit
      const res = await request(app)
        .post('/api/device/verify-imei')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ imei: '356938035643808' });

      expect(res.statusCode).toBe(422);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toMatch(/Invalid IMEI checksum/i);
    });

    it('should validate alphanumeric serial numbers', async () => {
      const res = await request(app)
        .post('/api/device/verify-imei')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ imei: 'F17D9X01GH5W' });

      expect(res.statusCode).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.format).toBe('SERIAL');
    });
  });

  describe('POST /api/listing/create', () => {
    it('publishes a listing immediately for an approved dealer', async () => {
      mockFirestore.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'approved' })
      });

      const res = await request(app)
        .post('/api/listing/create')
        .set('Authorization', 'Bearer valid-user-token')
        .send({
          storeId: 'store_123',
          storeName: 'Test Store',
          brand: 'Apple',
          model: 'iPhone 15 Pro',
          marketValue: 1250000,
          quantityInStock: 1,
          hubAddress: 'Computer Village, Ikeja',
          whatsappNumber: '+2348012345678',
          mediaFiles: [{ url: 'https://res.cloudinary.com/example/image/upload/phone.jpg' }]
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.listingId).toBe('test-doc-id');
      expect(res.body.status).toBe('active');
      expect(mockFirestore.add).toHaveBeenCalledWith(expect.objectContaining({
        storeOwnerUid: 'user_123',
        storeId: 'store_123',
        model: 'iPhone 15 Pro',
        marketValue: 1250000,
        hubAddress: 'Computer Village, Ikeja',
        whatsappNumber: '+2348012345678',
        status: 'active'
      }));
    });

    it('requires approved dealer verification before publishing', async () => {
      const res = await request(app)
        .post('/api/listing/create')
        .set('Authorization', 'Bearer valid-user-token')
        .send({ brand: 'Apple', model: 'iPhone 15 Pro', marketValue: 1250000 });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Dealer verification must be approved/i);
      expect(mockFirestore.add).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/swap/create', () => {
    it('creates a swap request only against an active dealer listing', async () => {
      mockFirestore.get
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({
            storeOwnerUid: 'dealer_123',
            storeName: 'Test Store',
            status: 'active',
            quantityInStock: 1,
            isSwapAllowed: true,
            brand: 'Apple',
            model: 'iPhone 15 Pro',
            storage: '256GB',
            marketValue: 1250000
          })
        })
        .mockResolvedValueOnce({ empty: true });

      const res = await request(app)
        .post('/api/swap/create')
        .set('Authorization', 'Bearer valid-user-token')
        .send({
          storeUid: 'dealer_123',
          targetListingId: 'listing_123',
          targetDevice: {},
          currentDevice: {
            brand: 'Apple',
            model: 'iPhone 13',
            storage: '128GB',
            condition: 'Good',
            batteryHealth: 87,
            imeiNumber: '356938035643809'
          },
          topupAmount: '₦0',
          offeredPrice: '₦400,000',
          customerPhone: '08012345678'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('pending');
      expect(mockFirestore.add).toHaveBeenCalledWith(expect.objectContaining({
        customerUid: 'user_123',
        dealerUid: 'dealer_123',
        targetListingId: 'listing_123',
        currentDevice: expect.objectContaining({ model: 'iPhone 13', imeiNumber: '356938035643809' }),
        targetDevice: expect.objectContaining({ listingId: 'listing_123', model: 'iPhone 15 Pro' }),
        offeredPrice: 400000,
        topupAmount: 0
      }));
    });

    it('rejects requests that try to target another dealer listing', async () => {
      mockFirestore.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storeOwnerUid: 'dealer_456', status: 'active', quantityInStock: 1 })
      });

      const res = await request(app)
        .post('/api/swap/create')
        .set('Authorization', 'Bearer valid-user-token')
        .send({
          storeUid: 'dealer_123',
          targetListingId: 'listing_123',
          targetDevice: {},
          currentDevice: { brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiNumber: '356938035643809' }
        });

      expect(res.statusCode).toBe(403);
      expect(mockFirestore.add).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/swapper/listing/create', () => {
    it('rejects the retired swapper phone-listing flow', async () => {
      const res = await request(app)
        .post('/api/swapper/listing/create')
        .send({});

      expect(res.statusCode).toBe(410);
      expect(res.body.error).toMatch(/Only dealers can list phones/i);
    });
  });
  describe('POST /api/payments/webhook', () => {
    it('should reject webhooks without x-paystack-signature header', async () => {
      const res = await request(app)
        .post('/api/payments/webhook')
        .send({ event: 'charge.success' });
      expect(res.statusCode).toBe(401);
    });

    it('should verify valid HMAC-SHA512 Paystack webhook signatures', async () => {
      const secret = 'sk_test_secret_key_123';
      const bodyData = JSON.stringify({
        event: 'charge.success',
        data: {
          reference: 'naijaswap_req_123_456',
          amount: 5000000,
          metadata: { requestId: 'req_123' }
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
    });

    it('should reject webhooks with an invalid HMAC signature', async () => {
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('x-paystack-signature', 'invalid_signature_hash_string')
        .send({ event: 'charge.success' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/certificate', () => {
    it('should return 400 if no id is provided', async () => {
      const res = await request(app).get('/api/certificate');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/ID is required/i);
    });
  });
});
