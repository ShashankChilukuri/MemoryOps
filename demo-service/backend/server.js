import "dotenv/config";
import cors from "cors";
import express from "express";
import { MongoClient } from "mongodb";

const app = express();
const port = Number(process.env.PORT || 3000);
const url = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/memoryops_demo";
const timeout = Number(process.env.PAYMENT_TIMEOUT_MS || 30000);
const known = ["payment_timeout", "gateway_502", "db_pool_exhausted", "slow_query"];

let active = null;
let mongo;

const MEMORYOPS_LOG_URL =
  process.env.MEMORYOPS_LOG_URL || "http://localhost:5000/api/logs";

app.use(cors());
app.use(express.json());

const log = (level, component, message) => {
  const ts = new Date().toISOString();
  console.log(`${ts} ${level} ${component}: ${message}`);

  let service = "order-service";
  if (
    component === "PaymentGateway" ||
    component === "Config" ||
    component === "Checkout" ||
    component.toLowerCase().includes("stripe")
  ) {
    service = "payment-service";
  } else if (
    component === "MongoQuery" ||
    component.toLowerCase().includes("restaurant")
  ) {
    service = "restaurant-service";
  }

  fetch(MEMORYOPS_LOG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      events: [
        {
          timestamp: ts,
          level,
          service,
          message: `${component}: ${message}`,
          context: { source: "demo-service", component, env: "demo" },
        },
      ],
    }),
  }).catch(() => {
    // Non-blocking log shipping
  });
};

const db = () => mongo.db();

app.get("/health", (_q, r) => r.json({ ok: true }));

app.get("/admin/faults", (_q, r) => r.json({ active, known }));

app.post("/admin/faults/:fault", (q, r) => {
  if (q.params.fault === "reset") active = null;
  else if (!known.includes(q.params.fault))
    return r.status(400).json({ error: "Unknown fault" });
  else active = q.params.fault;
  r.json({ active, known });
});

app.get("/restaurants", async (q, r) => {
  const start = Date.now();
  try {
    if (active === "slow_query") {
      const n = 1000 + Math.floor(Math.random() * 9000);
      log("WARN", "MongoQuery", `COLLSCAN on restaurants, docsExamined=${n}`);
      await new Promise((x) => setTimeout(x, 1000));
      log("ERROR", "API", `GET /restaurants p95 latency ${Date.now() - start}ms`);
    }
    const f = {};
    if (q.query.city) f.city = { $regex: String(q.query.city), $options: "i" };
    if (q.query.cuisine) f.cuisine = { $regex: String(q.query.cuisine), $options: "i" };
    const restaurants = mongo
      ? await db().collection("restaurants").find(f).limit(50).toArray()
      : [];
    r.json({ restaurants, count: restaurants.length, latencyMs: Date.now() - start });
  } catch (e) {
    r.status(500).json({ error: e.message });
  }
});

app.post("/checkout", async (_q, r) => {
  if (active === "payment_timeout") {
    log("WARN", "Config", "STRIPE_API_URL is undefined");
    await new Promise((x) => setTimeout(x, Math.min(timeout, 5000)));
    log("ERROR", "PaymentGateway", `request timeout after ${timeout}ms`);
    log("ERROR", "Checkout", "payment confirmation failed, retry 3/3");
    return r.status(504).json({ error: "Payment confirmation timed out" });
  }

  if (active === "gateway_502") {
    log("ERROR", "PaymentGateway", "upstream responded 502 Bad Gateway");
    log("WARN", "Checkout", "circuit breaker opened after 3 consecutive failures");
    return r.status(502).json({ error: "Payment gateway unavailable" });
  }

  if (active === "db_pool_exhausted") {
    log("ERROR", "MongoPool", "no available connections");
    log("ERROR", "API", "POST /checkout 503");
    return r.status(503).json({ error: "Database connection pool exhausted" });
  }

  r.json({ ok: true, orderId: `demo-${Date.now()}` });
});

const server = app.listen(port, async () => {
  try {
    mongo = await MongoClient.connect(url, { serverSelectionTimeoutMS: 5000 });
    console.log(`Demo service listening on port ${port} (MongoDB connected)`);
  } catch (e) {
    console.warn(`Demo service running on port ${port} (MongoDB not connected: ${e.message})`);
  }
});

process.on("SIGTERM", async () => {
  await mongo?.close();
  server.close();
});
