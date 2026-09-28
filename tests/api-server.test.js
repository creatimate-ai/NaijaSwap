const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

// Mock firebase-admin before requiring api-server
jest.mock('firebase-admin', () => {
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

  return {
    apps: [{}],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    auth: jest.fn().mockReturnValue({
      verifyIdToken: jest.fn().mockImplementation((token) => {
        if (token === 'valid-user-token') {
          return Promise.resolve({ uid: 'user_123', email: 'test@example.com' });
        }
        if (token === 'valid-admin-token') {
          return Promise.resolve({ uid: 'admin_123', email: 'admin@example.com', admin: true });
        }
        return Promise.reject(new Error('Invalid token'));
      })
    }),
    firestore: jest.fn().mockReturnValue(mockFirestore)
  };
});

const apiRouter = require('../api-server');

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
      expect(res.body.paystackConfigured).toBe(true);
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
