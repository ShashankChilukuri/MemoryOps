const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const orderId = () => `ORD-${rand(1000, 9999)}`;
const ts = () => new Date().toISOString();

export const scenarios = {
  payment_timeout: () => ({
    title: "Payment gateway timeouts during checkout",
    service: "payment-service",
    severity: "critical",
    logs: [
      `${ts()} ERROR PaymentGateway: request timeout after 30000ms (orderId=${orderId()})`,
      `${ts()} ERROR Checkout: payment confirmation failed, retry 3/3`,
      `${ts()} WARN  Config: STRIPE_API_URL is undefined, using fallback`,
      `${ts()} ERROR Checkout: ${rand(20, 60)} orders failed in last 5 minutes`,
    ],
    context: { lastDeploy: `v2.4.1, ${rand(5, 20)} min ago`, region: "ap-south-1" },
  }),

  payment_gateway_502: () => ({
    title: "Payment provider returning 502 Bad Gateway",
    service: "payment-service",
    severity: "critical",
    logs: [
      `${ts()} ERROR PaymentGateway: upstream responded 502 Bad Gateway (orderId=${orderId()})`,
      `${ts()} ERROR PaymentGateway: provider status page reports degraded performance`,
      `${ts()} WARN  Checkout: circuit breaker opened after ${rand(5, 15)} consecutive failures`,
    ],
    context: { lastDeploy: "v2.3.9, 2 days ago", region: "ap-south-1" },
  }),

  db_pool_exhausted: () => ({
    title: "MongoDB connection pool exhausted",
    service: "order-service",
    severity: "high",
    logs: [
      `${ts()} ERROR MongoPool: no available connections (max=${rand(10, 20)}, waiting=${rand(30, 90)})`,
      `${ts()} ERROR OrderService: createOrder timed out waiting for connection`,
      `${ts()} WARN  OrderService: cursor not closed in getOrderHistory()`,
      `${ts()} ERROR API: POST /orders 503 (${rand(2000, 9000)}ms)`,
    ],
    context: { lastDeploy: "v2.4.0, 1 day ago", trafficSpike: true },
  }),

  cart_null_reference: () => ({
    title: "Cart crashes with null reference after schema change",
    service: "cart-service",
    severity: "high",
    logs: [
      `${ts()} ERROR CartService: TypeError: Cannot read properties of undefined (reading 'price')`,
      `${ts()}   at calculateTotal (cart.js:${rand(40, 120)})`,
      `${ts()} WARN  Migration: menu items missing field 'pricing.base' for ${rand(50, 300)} documents`,
      `${ts()} ERROR API: GET /cart 500 (userId=U${rand(100, 999)})`,
    ],
    context: { lastDeploy: `v2.4.2, ${rand(10, 40)} min ago`, change: "menu schema migration" },
  }),

  slow_menu_query: () => ({
    title: "Restaurant listing endpoint extremely slow",
    service: "restaurant-service",
    severity: "medium",
    logs: [
      `${ts()} WARN  MongoQuery: restaurants.find({city, cuisine}) took ${rand(4000, 12000)}ms`,
      `${ts()} WARN  MongoQuery: COLLSCAN on restaurants, docsExamined=${rand(80000, 400000)}`,
      `${ts()} ERROR API: GET /restaurants p95 latency ${rand(5, 12)}s`,
    ],
    context: { lastDeploy: "none in 5 days", dataGrowth: "restaurants collection 4x in 2 weeks" },
  }),

  jwt_auth_loop: () => ({
    title: "Users stuck in login loop, token rejected",
    service: "auth-service",
    severity: "high",
    logs: [
      `${ts()} ERROR Auth: JsonWebTokenError: invalid signature (userId=U${rand(100, 999)})`,
      `${ts()} WARN  Auth: JWT_SECRET changed at last deploy, existing tokens invalid`,
      `${ts()} ERROR Auth: ${rand(200, 900)} token verification failures in 10 minutes`,
    ],
    context: { lastDeploy: `v2.4.1, ${rand(5, 30)} min ago`, change: "secrets rotation" },
  }),
};