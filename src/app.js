const express = require('express');
const cors = require('cors');

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '100kb' }));

// Basic security headers (helmet-lite)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Very small in-memory rate limiter for the login endpoint (brute-force protection).
const attempts = new Map();
app.use('/api/auth/login', (req, res, next) => {
  const key = req.ip, now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (list.length >= 20) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  list.push(now); attempts.set(key, list); next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'steakz-mis-api', time: new Date().toISOString() }));
app.use('/api/public', require('./routes/public'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/users', require('./routes/users'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// The front end is a separate project (steakz-frontend); this server only answers /api.
app.get('/', (req, res) => res.json({ service: 'Steakz MIS API', docs: 'See README.md for the endpoint list', health: '/api/health' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message, ...(err.fields ? { fields: err.fields } : {}) });
});

module.exports = app;
