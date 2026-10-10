// Writes one JSON object per line to logs/app.log
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.resolve(process.env.LOG_FILE || 'logs/app.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const BASE_CONTEXT = {
  lastDeploy: process.env.LAST_DEPLOY || 'v2.4.1',
  region: process.env.REGION || 'ap-south-1',
};

// service must be one of: payment-service, order-service, cart-service, restaurant-service
function log(level, service, message, context = {}) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    context: { ...BASE_CONTEXT, ...context },
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(line) + '\n');
  return line;
}

// Last N parsed lines (reads only the tail of the file)
function recent(limit = 50) {
  limit = Math.max(1, Math.min(Number(limit) || 50, 500));
  if (!fs.existsSync(LOG_FILE)) return [];
  const size = fs.statSync(LOG_FILE).size;
  const len = Math.min(size, 256 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(LOG_FILE, 'r');
  try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  if (len < size) lines.shift(); // first line is probably cut off
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { log, recent, LOG_FILE };
