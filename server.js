const express = require('express');
const path = require('path');
const apiRouter = require('./api-server');

const app = express();
const port = Number(process.env.PORT) || 10000;
const publicRoot = path.resolve(__dirname);
const allowedOrigins = new Set([
  'https://naijaswap.web.app',
  'https://naijaswap1.web.app',
  'https://naijaswap.firebaseapp.com',
  'http://localhost:10000',
  'http://127.0.0.1:10000',
  ...(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
]);

app.disable('x-powered-by');
app.use((request, response, next) => {
  const origin = (request.get('origin') || '').replace(/\/$/, '');
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
  }
  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) {
      return response.sendStatus(403);
    }
    return response.status(204).end();
  }
  return next();
});
app.use(express.json({ limit: '1mb' }));
app.use(apiRouter);
app.use(express.static(publicRoot, {
  index: 'index.html',
  setHeaders(response, filePath) {
    if (/\.(html|js)$/.test(filePath)) {
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.get(/.*/, (request, response) => {
  response.sendFile(path.join(publicRoot, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`NaijaSwap is listening on port ${port}`);
});
