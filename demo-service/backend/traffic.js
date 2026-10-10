// Steady fake requests so a switched-on fault shows up in the logs right away.
// Used by POST /traffic, or run standalone: npm run traffic
const CITIES = ['Hyderabad', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Pune'];
const CUISINES = ['north indian', 'biryani', 'chinese', 'italian', 'thai', 'south indian'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const MAX_IN_FLIGHT = 60;

function createTraffic({ baseUrl }) {
  let timer = null;
  let rps = 2;
  let inFlight = 0;

  function fire() {
    if (inFlight >= MAX_IN_FLIGHT) return;
    const r = Math.random();
    let method = 'GET', path;
    if (r < 0.4) { method = 'POST'; path = '/checkout'; }
    else if (r < 0.7) path = '/cart';
    else path = `/restaurants?city=${encodeURIComponent(pick(CITIES))}&cuisine=${encodeURIComponent(pick(CUISINES))}`;

    inFlight++;
    fetch(baseUrl + path, { method, signal: AbortSignal.timeout(8000) })
      .then(res => res.arrayBuffer())
      .catch(() => {}) // slow/failed requests are expected while a fault is on
      .finally(() => { inFlight--; });
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }
  function start(newRps) {
    if (newRps !== undefined) rps = Math.min(20, Math.max(0.2, Number(newRps) || rps));
    stop();
    timer = setInterval(fire, 1000 / rps);
  }
  const status = () => ({ enabled: !!timer, rps });

  return { start, stop, status };
}

module.exports = { createTraffic };

if (require.main === module) {
  require('dotenv').config();
  const port = Number(process.env.PORT) || 4000;
  const t = createTraffic({ baseUrl: `http://localhost:${port}` });
  t.start(Number(process.env.TRAFFIC_RPS) || 1);
  console.log(`traffic: ~${t.status().rps} req/s to http://localhost:${port} (Ctrl+C to stop)`);
}
