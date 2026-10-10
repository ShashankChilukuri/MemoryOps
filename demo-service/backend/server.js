require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { log, recent } = require('./logger');
const { createChaos } = require('./chaos');
const { createTraffic } = require('./traffic');

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS) || 30000;
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 100;
const SLOW_P95_MS = Number(process.env.SLOW_P95_MS) || 150;
// Healthy payment provider = the built-in fake upstream. chaos.js captures this at startup.
process.env.STRIPE_API_URL = process.env.STRIPE_API_URL || `http://localhost:${PORT}/fake-upstream/ok`;

let orders, restaurants, chaos;
const traffic = createTraffic({ baseUrl: `http://localhost:${PORT}` });

const app = express();
app.use(cors());
app.use(express.json());

// ---------- per-request log line + last-minute counters ----------
const reqTimes = [], errTimes = [];
const lastMinute = arr => { const cut = Date.now() - 60000; while (arr.length && arr[0] < cut) arr.shift(); return arr.length; };
const SERVICE_FOR = { '/checkout': 'order-service', '/cart': 'cart-service', '/restaurants': 'restaurant-service' };

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const service = SERVICE_FOR[req.path];
    if (!service) return; // skip /health, /chaos, /logs, /traffic, /fake-upstream
    reqTimes.push(Date.now());
    if (res.statusCode >= 500) errTimes.push(Date.now());
    log(res.statusCode >= 500 ? 'ERROR' : 'INFO', service,
      `API: ${req.method} ${req.path} ${res.statusCode}`, { durationMs: Date.now() - t0 });
  });
  next();
});

// ---------- payment gateway (+ circuit breaker) ----------
const breaker = { failures: 0, openUntil: 0, threshold: 3, cooldownMs: 10000 };
const resetBreaker = () => { breaker.failures = 0; breaker.openUntil = 0; };

async function callGateway(orderId) {
  // If config is missing, the code falls back to a default host that never answers.
  const url = process.env.STRIPE_API_URL || chaos.blackholeUrl;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PAYMENT_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId }),
    });
    if (!r.ok) { const e = new Error('upstream error'); e.status = r.status; e.statusText = r.statusText || 'Bad Gateway'; throw e; }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('timeout'); t.timeout = true; throw t; }
    throw e;
  } finally { clearTimeout(timer); }
}

async function charge(orderId) {
  if (!process.env.STRIPE_API_URL) log('WARN', 'payment-service', 'Config: STRIPE_API_URL is undefined', { orderId });
  if (Date.now() < breaker.openUntil) { const e = new Error('circuit open'); e.circuit = true; throw e; }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = await callGateway(orderId);
      breaker.failures = 0;
      return out;
    } catch (e) {
      if (e.timeout) {
        log('ERROR', 'payment-service', `PaymentGateway: request timeout after ${PAYMENT_TIMEOUT_MS}ms`, { orderId });
        if (attempt === 3) {
          log('ERROR', 'payment-service', 'Checkout: payment confirmation failed, retry 3/3', { orderId });
          throw e;
        }
        continue; // retry timeouts only
      }
      if (e.status) {
        log('ERROR', 'payment-service', `PaymentGateway: upstream responded ${e.status} ${e.statusText}`, { orderId });
        if (++breaker.failures >= breaker.threshold) {
          breaker.openUntil = Date.now() + breaker.cooldownMs;
          log('WARN', 'payment-service', `Checkout: circuit breaker opened after ${breaker.failures} consecutive failures`);
          breaker.failures = 0;
        }
        throw e;
      }
      log('ERROR', 'payment-service', `PaymentGateway: ${e.message}`, { orderId });
      throw e;
    }
  }
}

const isPoolError = e => e && (e.name === 'MongoWaitQueueTimeoutError' || /checking out a connection|wait queue/i.test(e.message || ''));

// ---------- routes ----------
app.post('/checkout', async (req, res) => {
  const orderId = `ORD-${1000 + Math.floor(Math.random() * 9000)}`;
  try {
    if (chaos.isOn('db_pool_exhausted')) await chaos.leakConnection(); // the fault: leak, never release
    await orders.insertOne({ orderId, status: 'pending', at: new Date() });
    await charge(orderId);
    await orders.updateOne({ orderId }, { $set: { status: 'paid' } });
    res.json({ orderId, status: 'confirmed' });
  } catch (e) {
    if (isPoolError(e)) {
      log('ERROR', 'order-service', 'MongoPool: no available connections', { orderId });
      return res.status(503).json({ error: 'database unavailable', orderId });
    }
    if (e.circuit) return res.status(503).json({ error: 'payment circuit open', orderId });
    if (e.timeout) return res.status(504).json({ error: 'payment timeout', orderId });
    if (e.status) return res.status(502).json({ error: 'payment upstream failed', orderId });
    log('ERROR', 'order-service', `Checkout: ${e.message}`, { orderId });
    res.status(500).json({ error: 'internal error', orderId });
  }
});

const cart = [{ name: 'Paneer Tikka', price: 240, qty: 2 }, { name: 'Garlic Naan', price: 60, qty: 3 }];
app.get('/cart', (_req, res) => {
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  res.json({ items: cart, total });
});

const rLat = [];
let lastP95Log = 0;
const p95 = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] || 0; };

async function reportSlowQuery(filter, ms) {
  rLat.push(ms); if (rLat.length > 50) rLat.shift();
  if (ms >= SLOW_QUERY_MS) { // like Mongo's slow-query log: only explain slow ones
    try {
      const ex = await restaurants.find(filter).sort({ rating: -1 }).limit(20).explain('executionStats');
      if (JSON.stringify(ex.queryPlanner.winningPlan).includes('COLLSCAN')) {
        log('WARN', 'restaurant-service', `MongoQuery: COLLSCAN on restaurants, docsExamined=${ex.executionStats.totalDocsExamined}`, { filter, durationMs: ms });
      }
    } catch { /* explain is best-effort */ }
  }
  const p = p95(rLat);
  if (p >= SLOW_P95_MS && Date.now() - lastP95Log > 5000) {
    lastP95Log = Date.now();
    log('ERROR', 'restaurant-service', `API: GET /restaurants p95 latency ${(p / 1000).toFixed(2)}s`, { p95Ms: p });
  }
}

app.get('/restaurants', async (req, res) => {
  const filter = { city: req.query.city || 'Hyderabad', cuisine: req.query.cuisine || 'biryani' };
  const t0 = Date.now();
  try {
    const docs = await restaurants.find(filter).sort({ rating: -1 }).limit(20).toArray();
    const ms = Date.now() - t0;
    await reportSlowQuery(filter, ms);
    res.json({ count: docs.length, ms, restaurants: docs });
  } catch (e) {
    if (isPoolError(e)) {
      log('ERROR', 'restaurant-service', 'MongoPool: no available connections');
      return res.status(503).json({ error: 'database unavailable' });
    }
    log('ERROR', 'restaurant-service', `MongoQuery: ${e.message}`);
    res.status(500).json({ error: 'internal error' });
  }
});

// Fake payment provider
app.post('/fake-upstream/ok', (_req, res) => res.json({ id: 'ch_fake', status: 'succeeded' }));
app.post('/fake-upstream/502', (_req, res) => res.status(502).send('Bad Gateway'));

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  activeFaults: chaos ? chaos.active() : [],
  faults: chaos ? chaos.snapshot() : {},
  requestsLastMinute: lastMinute(reqTimes),
  errorsLastMinute: lastMinute(errTimes), // responses with status >= 500
  traffic: traffic.status(),
}));

// ---------- chaos control ----------
function afterChange(name) {
  if (name === 'gateway_502') resetBreaker();
  if (name === 'slow_query') rLat.length = 0;
}

app.post('/chaos/reset', async (_req, res) => {
  await chaos.reset();
  resetBreaker(); rLat.length = 0;
  res.json({ active: [], faults: chaos.snapshot() });
});

app.post('/chaos/:scenario', async (req, res) => {
  const { scenario } = req.params;
  const enabled = req.body && req.body.enabled;
  if (!chaos.has(scenario)) return res.status(404).json({ error: `unknown scenario: ${scenario}`, known: chaos.names() });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'body must be {"enabled": true|false}' });
  await chaos.set(scenario, enabled);
  afterChange(scenario);
  res.json({ scenario, enabled, active: chaos.active(), faults: chaos.snapshot() });
});

app.post('/traffic', (req, res) => {
  const { enabled, rps } = req.body || {};
  if (enabled) traffic.start(rps); else traffic.stop();
  res.json(traffic.status());
});

app.get('/logs/recent', (req, res) => res.json({ lines: recent(req.query.limit) }));

app.use((err, _req, res, _next) => { // last-resort handler
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// ---------- boot ----------
(async () => {
  const client = new MongoClient(MONGO_URL, {
    maxPoolSize: Number(process.env.POOL_SIZE) || 3, // small on purpose
    waitQueueTimeoutMS: 500,                          // fail fast when the pool is starved
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'demo_service');
  orders = db.collection('orders');
  restaurants = db.collection('restaurants');
  chaos = createChaos({ db, port: PORT, seedCount: Number(process.env.SEED_COUNT) || 400000 });
  await chaos.ensureBaseData();
  app.listen(PORT, () => console.log(`demo-service on http://localhost:${PORT}, logging to ${require('./logger').LOG_FILE}`));
})().catch(e => { console.error('startup failed:', e.message); process.exit(1); });