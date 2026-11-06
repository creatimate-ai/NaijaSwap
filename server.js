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
  'https://naijaswap-admin.web.app',
  'https://naijaswap-admin.firebaseapp.com',
  'https://nigerswap-admin.web.app',
  'http://localhost:10000',
  'http://127.0.0.1:10000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
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
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(apiRouter);

// Protect server-side source code, configuration and sensitive files from public access
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

app.use(express.static(publicRoot, {
  index: 'index.html',
  extensions: ['html'],
  setHeaders(response, filePath) {
    if (/\.(html|js)$/.test(filePath)) {
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Route aliases for clean URLs
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicRoot, 'dashboard.html')));
app.get('/dealer-dashboard', (req, res) => res.sendFile(path.join(publicRoot, 'dealer-dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicRoot, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(publicRoot, 'signup.html')));
app.get('/listing-activity', (req, res) => res.sendFile(path.join(publicRoot, 'listing-activity.html')));
app.get('/admin', (req, res) => res.redirect('https://naijaswap-admin.web.app'));
app.get('/admin-portal', (req, res) => res.redirect('https://naijaswap-admin.web.app'));

app.get(/.*/, (request, response) => {
  response.sendFile(path.join(publicRoot, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`NaijaSwap is listening on port ${port}`);
});
