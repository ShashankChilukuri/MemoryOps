// Script to send a realistic burst of payment-timeout log events to MemoryOps backend
const API_URL = process.env.API_URL || "http://localhost:5000/api/logs";

async function sendBurst() {
  const now = new Date();
  const t1 = new Date(now.getTime() - 2000).toISOString();
  const t2 = new Date(now.getTime() - 1000).toISOString();
  const t3 = now.toISOString();

  const payload = {
    events: [
      {
        timestamp: t1,
        level: "WARN",
        service: "payment-service",
        message: "Config: STRIPE_API_URL is undefined, using fallback",
        context: { region: "ap-south-1", env: "production" },
      },
      {
        timestamp: t2,
        level: "ERROR",
        service: "payment-service",
        message: "PaymentGateway: request timeout after 30000ms (orderId=ORD-4921)",
        context: { region: "ap-south-1", gateway: "stripe", timeoutMs: 30000 },
      },
      {
        timestamp: t3,
        level: "ERROR",
        service: "payment-service",
        message: "Checkout: payment confirmation failed, retry 3/3",
        context: { region: "ap-south-1", attempts: 3 },
      },
    ],
  };

  console.log(`Sending burst of ${payload.events.length} logs to ${API_URL}...`);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    console.log(`Response [${res.status}]:`, JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("Failed to post logs:", err.message);
  }
}

sendBurst();
