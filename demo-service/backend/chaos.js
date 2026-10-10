// Fault switches. Each fault changes REAL behavior; the log lines are a result, not typed in.
const net = require('net');

const FAULTS = {
  payment_timeout: {
    title: 'Payment timeout',
    description: 'STRIPE_API_URL is deleted from the running config; checkout calls an unreachable address and waits.',
    symptom: '/checkout hangs, then fails after 3 retries',
  },
  gateway_502: {
    title: 'Gateway 502',
    description: 'Checkout is pointed at an upstream that answers 502 Bad Gateway.',
    symptom: '/checkout fails fast with 502, then the circuit breaker opens',
  },
  db_pool_exhausted: {
    title: 'DB pool exhausted',
    description: 'Every request leaks a Mongo connection and never releases it (pool size is small).',
    symptom: '/checkout returns 503: no available connections',
  },
  slow_query: {
    title: 'Slow query',
    description: 'The city/cuisine index is dropped and the restaurants collection is grown to hundreds of thousands of docs.',
    symptom: '/restaurants latency climbs (collection scan)',
  },
};

const CITIES = ['Hyderabad', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Pune'];
const CUISINES = ['north indian', 'biryani', 'chinese', 'italian', 'thai', 'south indian'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const restaurantDoc = i => ({
  name: `Restaurant ${i}`,
  city: CITIES[i % 6],
  cuisine: CUISINES[Math.floor(i / 6) % 6],
  rating: 1 + ((i * 7) % 40) / 10,
});

function createChaos({ db, port, seedCount = 400000 }) {
  const state = Object.fromEntries(Object.keys(FAULTS).map(k => [k, { enabled: false, since: null }]));
  const healthyStripeUrl = process.env.STRIPE_API_URL;
  const restaurants = db.collection('restaurants');
  const leaks = [];
  const MAX_LEAKS = 10;
  let seeding = false;

  // A TCP listener that accepts connections and never answers: a deterministic
  // "unreachable address" on every OS (public blackhole IPs can fail instantly on some networks).
  const hole = net.createServer(sock => sock.on('error', () => {}));
  hole.on('error', e => console.error(`blackhole listener failed on port ${port + 1}: ${e.message}`));
  hole.listen(port + 1, '127.0.0.1');
  const blackholeUrl = `http://127.0.0.1:${port + 1}/v1/charges`;

  function applyPaymentEnv() {
    if (state.payment_timeout.enabled) delete process.env.STRIPE_API_URL;
    else if (state.gateway_502.enabled) process.env.STRIPE_API_URL = `http://localhost:${port}/fake-upstream/502`;
    else process.env.STRIPE_API_URL = healthyStripeUrl;
  }

  // Open a tailable cursor on a capped collection: its getMore blocks server-side,
  // pinning one pooled connection until the cursor is closed. Works without server-side JS.
  async function leakConnection() {
    if (leaks.length >= MAX_LEAKS) return;
    const cursor = db.collection('leak_feed').find({}, {
      tailable: true, awaitData: true, maxAwaitTimeMS: 2000, batchSize: 1,
    });
    leaks.push(cursor);
    (async () => {
      try { while (!cursor.closed) { await cursor.next(); await sleep(5); } } catch { /* closed or pool starved */ }
    })();
    await sleep(100); // give it time to grab its connection
  }
  async function releaseLeaks() {
    await Promise.all(leaks.splice(0).map(c => c.close().catch(() => {})));
  }

  async function seedRestaurants(target) {
    if (seeding) return;
    seeding = true;
    try {
      let n = await restaurants.estimatedDocumentCount();
      while (n < target) {
        const batch = [];
        for (let i = 0; i < 10000 && n + i < target; i++) batch.push(restaurantDoc(n + i));
        await restaurants.insertMany(batch, { ordered: false });
        n += batch.length;
      }
    } finally { seeding = false; }
  }
  const ensureIndex = () => restaurants.createIndex({ city: 1, cuisine: 1 }, { name: 'city_cuisine' });

  async function ensureBaseData() {
    try { await db.createCollection('leak_feed', { capped: true, size: 4096, max: 10 }); } catch { /* exists */ }
    const feed = db.collection('leak_feed');
    if (!(await feed.countDocuments())) await feed.insertOne({ seed: true });
    await seedRestaurants(1000);
    await ensureIndex();
  }

  async function set(name, enabled) {
    const s = state[name];
    if (s.enabled === enabled) return;
    s.enabled = enabled;
    s.since = enabled ? new Date().toISOString() : null;
    if (name === 'payment_timeout' || name === 'gateway_502') applyPaymentEnv();
    if (name === 'db_pool_exhausted' && !enabled) await releaseLeaks();
    if (name === 'slow_query') {
      if (enabled) {
        try { await restaurants.dropIndex('city_cuisine'); } catch { /* already gone */ }
        seedRestaurants(seedCount).then(
          () => console.log(`restaurants grown to ${seedCount} docs`),
          e => console.error('seeding failed:', e.message));
      } else {
        ensureIndex().catch(e => console.error('index rebuild failed:', e.message));
      }
    }
    console.log(`chaos: ${name} ${enabled ? 'ENABLED' : 'disabled'}`);
  }

  return {
    names: () => Object.keys(FAULTS),
    has: name => Object.prototype.hasOwnProperty.call(FAULTS, name),
    isOn: name => state[name].enabled,
    active: () => Object.keys(state).filter(k => state[k].enabled),
    snapshot: () => Object.fromEntries(Object.entries(FAULTS).map(([k, v]) =>
      [k, { ...v, enabled: state[k].enabled, since: state[k].since }])),
    set,
    reset: async () => { for (const k of Object.keys(state)) await set(k, false); },
    leakConnection,
    ensureBaseData,
    blackholeUrl,
  };
}

module.exports = { createChaos };
