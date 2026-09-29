# MemoryOps

**An incident-response agent that gets better at diagnosing outages the more outages it sees.**

MemoryOps investigates production incidents the way a senior on-call engineer does: it looks at the logs, recalls similar incidents it has handled before, reasons about whether those past incidents actually apply, and recommends a fix — citing exactly which memories it used and why. When an engineer confirms the real root cause, that resolution is stored back into memory, so the next similar incident gets diagnosed faster and with higher confidence.

```
Production Logs → Incident Detection → Memory Recall → AI Diagnosis
→ Recommended Fix → Engineer Resolution → Memory Retention
```

## Why this exists

LLMs are stateless. Every incident, by default, is diagnosed from scratch — even if the exact same failure happened last month and someone already found the fix. Bolting on plain vector search over past incidents doesn't solve this cleanly either: two incidents can share a service name and superficial symptoms while having completely different root causes, and a naive similarity search will confidently hand back the wrong memory.

MemoryOps uses [Hindsight](https://github.com/vectorize-io/hindsight) as its memory layer instead of raw embedding search. Hindsight decomposes each retained incident into structured facts — observations, world state, and experiences — with entity extraction, and returns reranked relevance scores on recall. The diagnosis step is then explicitly told to judge relevance itself rather than trust recall blindly, so it can correctly ignore a memory that looks similar but doesn't actually match the current symptoms. See the [Hindsight docs](https://hindsight.vectorize.io/) for more on how retain/recall works, and [this page](https://vectorize.io/what-is-agent-memory) for the broader case for agent memory.

## Architecture

```
                    ┌─────────────────────┐
                    │   React dashboard   │
                    │      (engineer UI)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │      Express API     │
                    │ detects · diagnoses  │
                    │      · resolves      │
                    └───┬──────────┬───┬───┘
                        │          │   │
             ┌──────────▼──┐  ┌────▼───▼────┐  ┌─────────────┐
             │   MongoDB   │  │  Hindsight  │  │     Groq    │
             │  incident   │  │ long-term   │  │     LLM     │
             │   records   │  │   memory    │  │  diagnosis  │
             └─────────────┘  └─────────────┘  └─────────────┘
```

- **React (Vite)** — dashboard for triggering incidents, viewing diagnoses, and resolving them
- **Express (Node)** — orchestrates detection, recall, diagnosis, and resolution
- **MongoDB** — stores incident records, logs, and diagnosis history
- **Hindsight** — long-term memory: retains resolved incidents, recalls similar ones on new incidents
- **Groq** — runs the LLM that reasons over logs + recalled memories to produce a diagnosis

## Features

- **Incident simulation** — trigger realistic failure scenarios (payment timeouts, DB pool exhaustion, cart errors, slow queries, auth loops, gateway 502s) to generate log output on demand
- **Memory recall** — every new incident is checked against Hindsight for similar past incidents before diagnosis
- **AI diagnosis** — an LLM produces a probable cause, confidence score, suggested fix, and reasoning, grounded in the actual log lines
- **Relevance judgment** — the model reports exactly which recalled memories it used (or explicitly ignored, and why) — not just what it retrieved
- **Human-gated learning** — an engineer confirms the real root cause and fix before anything is written back to memory, so retained memories are always human-verified
- **Recurring issue detection** — incidents matching a confirmed past resolution are flagged and diagnosed with higher confidence

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | MongoDB (Mongoose) |
| Memory | [Hindsight](https://github.com/vectorize-io/hindsight) |
| LLM | Groq (`openai/gpt-oss-120b`) |

## Getting started

### Prerequisites

- Node.js 18+
- A MongoDB instance (local or Atlas)
- A [Hindsight Cloud](https://hindsight.vectorize.io/) account and API key (or a self-hosted instance)
- A Groq API key

### Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/memoryops
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
HINDSIGHT_URL=https://api.hindsight.vectorize.io
HINDSIGHT_API_KEY=your_hindsight_key
HINDSIGHT_BANK=memoryops
```

```bash
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL. You should see the MemoryOps dashboard.

### Seed some history (optional but recommended)

To pre-load past resolved incidents into both MongoDB and Hindsight, so recall has something to work with immediately:

```bash
cd backend
node seed.js
```

Run `node seed.js --dashboard-only` afterward if you ever want to repopulate the dashboard view without writing duplicate memories to Hindsight.

## API overview

| Endpoint | Description |
|---|---|
| `GET /api/simulate` | List available incident scenarios |
| `POST /api/simulate/:key` | Trigger a scenario, creating a new incident |
| `GET /api/incidents` | List incidents (optionally `?status=open`) |
| `GET /api/incidents/:id` | Get one incident |
| `POST /api/incidents/:id/diagnose` | Recall memories and generate an AI diagnosis |
| `POST /api/incidents/:id/resolve` | Confirm the real fix; retains it to Hindsight |
| `DELETE /api/incidents` | Clear the dashboard (Hindsight memory is untouched) |

## How the diagnosis stays honest

The diagnosis prompt explicitly forbids reusing a memory just because it's topically similar:

```js
const SYSTEM_PROMPT = `You are MemoryOps, a DevOps incident-response agent with long-term memory.
...
Rules:
- Use memories ONLY if they match the new incident's symptoms AND context.
  A shared service name alone is not enough.
- If memories describe a different root cause than the current logs suggest,
  say so and do NOT reuse their fix.
- If no memory is relevant, diagnose from the logs alone and set
  usedMemoryIds to [] and confidence at most 60.`;
```

Every diagnosis returns `usedMemoryIds` and a `memoryAssessment`, so the dashboard can show, for each recalled memory, whether it was actually used — and why or why not.

