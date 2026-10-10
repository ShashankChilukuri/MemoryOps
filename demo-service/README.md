# MemoryOps demo service

A demo app that produces predictable failure logs for testing observability tooling.

## Prerequisites

Node.js 18+ and a running MongoDB. Server-side JavaScript must be enabled in MongoDB for `db_pool_exhausted`.

## Start

Copy `backend/.env.example` to `backend/.env`, then run `npm install && npm run dev` in `backend`. In another terminal run `npm install && npm run dev` in `frontend`, then open http://localhost:5173.

## Scenarios

| Scenario | Trigger | Logs emitted |
|---|---|---|
| `payment_timeout` | Select, Place order | `WARN Config: STRIPE_API_URL is undefined`; `ERROR PaymentGateway: request timeout after 30000ms`; `ERROR Checkout: payment confirmation failed, retry 3/3` |
| `gateway_502` | Select, Place order | `ERROR PaymentGateway: upstream responded 502 Bad Gateway`; `WARN Checkout: circuit breaker opened after N consecutive failures` |
| `db_pool_exhausted` | Select, Place order | `ERROR MongoPool: no available connections`; `ERROR API: POST /checkout 503` |
| `slow_query` | Select, Search | `WARN MongoQuery: COLLSCAN on restaurants, docsExamined=N`; `ERROR API: GET /restaurants p95 latency Ns` |

Use Reset to clear the active fault. The Vite dev proxy maps `/api` to `http://localhost:3000`.
