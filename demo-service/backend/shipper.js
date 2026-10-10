// Separate process, like Filebeat/Fluent Bit: tails logs/app.log and POSTs new lines to MemoryOps.
// Does not import any service code.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.resolve(process.env.LOG_FILE || 'logs/app.log');
const OFFSET_FILE = LOG_FILE + '.offset';
const ENDPOINT = (process.env.MEMORYOPS_URL || 'http://localhost:5000').replace(/\/$/, '') + '/api/logs';
const BATCH_MS = Number(process.env.BATCH_MS) || 1000;
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 20;

let offset = 0;
let carry = Buffer.alloc(0);     // bytes of an incomplete last line
const queue = [];                // { event, end, queuedAt }
let skipped = 0;
let sending = false;
let backoff = 0, retryAt = 0;

// Resume from the saved offset; first run starts at the end so old history is not replayed.
function initOffset() {
  const size = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  try {
    const saved = Number(fs.readFileSync(OFFSET_FILE, 'utf8'));
    offset = Number.isFinite(saved) && saved <= size ? saved : 0;
  } catch { offset = size; }
}
const saveOffset = n => { try { fs.writeFileSync(OFFSET_FILE, String(n)); } catch { /* best effort */ } };

async function poll() {
  if (queue.length > 50000) return; // backpressure: the file stays the source of truth
  let size;
  try { size = fs.statSync(LOG_FILE).size; } catch { return; } // file not created yet
  if (size < offset) { offset = 0; carry = Buffer.alloc(0); } // truncated or rotated
  if (size === offset) return;

  const fh = await fs.promises.open(LOG_FILE, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    const data = Buffer.concat([carry, buf]);
    const base = offset - carry.length;
    let start = 0, idx;
    while ((idx = data.indexOf(10, start)) !== -1) {
      const line = data.subarray(start, idx).toString('utf8').trim();
      const end = base + idx + 1;
      start = idx + 1;
      if (!line) continue;
      try { queue.push({ event: JSON.parse(line), end, queuedAt: Date.now() }); }
      catch { skipped++; }
    }
    carry = data.subarray(start);
    offset = size;
  } finally { await fh.close(); }
}

async function flush() {
  sending = true;
  const batch = queue.slice(0, BATCH_SIZE);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch.map(b => b.event) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    queue.splice(0, batch.length);
    saveOffset(batch[batch.length - 1].end);
    backoff = 0;
    const touched = new Set(data.incidentIds || []).size;
    console.log(`shipped ${batch.length} lines, ${touched} incidents touched${skipped ? ` (${skipped} unparsable lines skipped so far)` : ''}`);
  } catch (e) { // keep the batch, retry with backoff: never drop lines
    backoff = Math.min(backoff ? backoff * 2 : 500, 5000);
    retryAt = Date.now() + backoff;
    console.warn(`ship failed (${e.message}); holding ${queue.length} lines, retrying in ${backoff}ms`);
  } finally { sending = false; }
}

function maybeFlush() {
  if (sending || !queue.length || Date.now() < retryAt) return;
  if (queue.length >= BATCH_SIZE || Date.now() - queue[0].queuedAt >= BATCH_MS) flush();
}

initOffset();
console.log(`shipper: tailing ${LOG_FILE} (from byte ${offset}) -> ${ENDPOINT}`);
setInterval(() => poll().catch(e => console.error('poll error:', e.message)), 250);
setInterval(maybeFlush, 100);
