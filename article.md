# Hindsight taught my on-call agent to stop misdiagnosing the same bug

The first time I ran MemoryOps against a real incident, it gave me a diagnosis with 55% confidence and a shrug: "this doesn't match anything I've seen before." Three weeks later, the same failure mode came back — different order IDs, different timestamp, same root cause — and the agent nailed it in about four seconds, cited the exact commit-adjacent fix from last time, and told me which of its own memories it was ignoring and why. That gap between the two runs is the entire reason I built this thing.

## What MemoryOps does

MemoryOps is an incident-response agent that sits between your logs and your engineers. When something breaks, it doesn't just tail the logs and page someone — it investigates. It pulls the relevant error output, searches its own memory of past incidents for anything that looks similar, asks an LLM to reason over both, and hands the on-call engineer a diagnosis with a confidence score, a suggested fix, and — critically — a list of exactly which past incidents it used to get there.

The loop looks like this:

```
Production Logs → Incident Detection → Memory Recall → AI Diagnosis
→ Recommended Fix → Engineer Resolution → Memory Retention
```

That last arrow is the one most incident tools skip. When an engineer confirms what actually fixed the problem, MemoryOps writes that resolution back into memory. The next time a similar failure shows up, the agent isn't reasoning from scratch — it's reasoning from experience.

The stack underneath is deliberately boring: Node and Express for the API, MongoDB for incident records, React for the dashboard, and Groq running an open-weight model for the actual diagnosis reasoning. The one non-boring piece is the memory layer, which I built on [Hindsight](https://github.com/vectorize-io/hindsight), an open-source memory system for AI agents. Everything else in this stack I could have swapped out. Hindsight is the part the whole idea depends on.

## Where Hindsight sits in the stack

Before getting into the memory design, it's worth being concrete about where the pieces actually live. The Express API is the orchestrator — it never talks to an engineer directly, and it never reasons on its own. It just coordinates three services and stitches their answers together:

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

MongoDB is just a system of record — incidents, their logs, whatever diagnosis got attached to them. Groq is stateless reasoning — it sees only what's in the prompt for that one call. Hindsight is the one box in that row that remembers anything between requests, and it's the only one the API calls twice per incident: once to recall before diagnosing, and once to retain after an engineer confirms the fix. Everything interesting in this article happens in that second box.

## The core problem: LLMs don't remember, and vector search isn't enough

Here's the thing nobody tells you when you start wiring an LLM into an ops workflow: the model is stateless, and "just add RAG" doesn't solve the actual problem. Naive vector search over a pile of past incident logs will happily hand you three memories that are semantically similar but causally irrelevant. I hit this almost immediately.

Two of my test scenarios were a payment gateway timeout caused by a missing `STRIPE_API_URL` environment variable, and — a few weeks later, in the story I'm telling here — a payment gateway returning a 502 because the provider itself was degraded. Both involve `payment-service`. Both involve checkout failures. Both happen in the same region. A pure embedding search treats these as nearly identical incidents, because at the vector-similarity level, they are. That's a genuinely dangerous failure mode for an ops agent: the worst thing MemoryOps could do is confidently tell an engineer to go check an env variable that has nothing to do with the actual outage.

This is the design decision the rest of the article hangs off: I didn't want memory that just returns "similar text." I wanted memory that returns *structured facts I could reason over*, so the diagnosis step could decide relevance instead of assuming it.

## How Hindsight changes the recall step

Hindsight doesn't store your incident as one blob and hand it back verbatim. When I retain an incident, it decomposes the text into distinct memory types — an `observation` (what happened), a `world` fact (the state of the system), and an `experience` (what the agent did about it) — and extracts named entities like service names and environment variables along the way. Here's the retain call, which is close to the actual integration:

```js
export function incidentToMemory(incident) {
  const r = incident.resolution;
  return [
    `Incident: ${incident.title}`,
    `Service: ${incident.service} | Severity: ${incident.severity}`,
    `Symptoms (logs): ${incident.logs.join(" || ")}`,
    `Context: ${JSON.stringify(incident.context)}`,
    `Root cause: ${r.rootCause}`,
    `Fix applied: ${r.fixApplied}`,
    `Outcome: ${r.outcome}`,
  ].join("\n");
}

export async function retainIncident(incident) {
  return client.retain(BANK, incidentToMemory(incident));
}
```

The recall side returns each memory with a reranked relevance score, not just a raw cosine similarity:

```js
export async function recallSimilar(incident) {
  const query = `${incident.title}. ${incident.service}. ${incident.logs.slice(0, 3).join(" ")}`;
  return client.recall(BANK, query);
}

export function simplifyMemories(recallResult, minScore = 0.3) {
  return (recallResult?.results || [])
    .filter((m) => (m.scores?.reranker ?? 0) >= minScore)
    .map((m) => ({
      id: m.id,
      type: m.type,
      text: m.text,
      relevance: Number((m.scores?.reranker ?? 0).toFixed(3)),
    }));
}
```

Here's what that raw recall response actually looks like from the terminal — each memory comes back with its own type, entities, and a breakdown of semantic, keyword, and reranked scores, not just a single similarity number:

![Terminal output showing a raw Hindsight recall response with reranker, semantic, and keyword scores for a retrieved memory](images/hindsight-recall-terminal.png)

That relevance score is where I ran into the limit of what memory infrastructure alone can do — and it's an honest one worth naming. When I fed the 502 incident into recall, all three Stripe-related memories came back with a reranker score around 0.98, because the entities and the service name genuinely do overlap. Hindsight surfaced them correctly; discrimination is not its job. So I didn't try to solve relevance filtering with a smarter threshold. I fed the memories, with their scores and entity tags, straight into the diagnosis prompt and made the LLM's job explicit: judge whether the symptoms actually match, not whether the topic overlaps.

## Making the LLM show its work

The diagnosis prompt is where the two systems — memory and reasoning — actually meet. The system prompt is blunt about what counts as a real match:

```
Rules:
- Use memories ONLY if they match the new incident's symptoms AND context.
  A shared service name alone is not enough.
- If memories describe a different root cause than the current logs suggest,
  say so and do NOT reuse their fix.
- If no memory is relevant, diagnose from the logs alone and set
  usedMemoryIds to [] and confidence at most 60.
```

And the response schema forces the model to be accountable for which memories it actually relied on:

```json
{
  "probableCause": "string",
  "confidence": 0,
  "suggestedFix": ["string"],
  "usedMemoryIds": ["ids of memories that informed this"],
  "isRecurring": false,
  "memoryAssessment": "how the past incidents compare to this one, or why none were relevant"
}
```

`usedMemoryIds` is the field that made this project feel trustworthy instead of just clever. Every memory Hindsight recalls gets rendered in the dashboard next to the diagnosis, tagged as either used or ignored, with the model's own explanation attached. An engineer can see, in plain language, why the agent trusted or distrusted a piece of its own history. That auditability matters more in an on-call context than almost anywhere else I've built with LLMs — the cost of a wrong, unexplained suggestion during an outage is real.

## Results: watching the agent actually learn

The clearest demonstration of this working is a two-run comparison on the same failure signature.

**First occurrence** — a database connection pool exhaustion, something the agent has no memory of:

> Probable cause: connection pool exhausted under load, likely a leaked connection.
> Confidence: 55%. usedMemoryIds: []. isRecurring: false.

The engineer resolves it: an unclosed cursor in a history-lookup function was leaking connections under load. That resolution gets retained.

**Second occurrence**, weeks later, same underlying bug reintroduced by a different code path:

> Probable cause: connection pool exhausted due to an unclosed cursor, matching a previously resolved incident.
> Confidence: 95%. usedMemoryIds: [the retained incident]. isRecurring: true.

Nothing about the diagnosis code changed between those two runs. The only thing that changed was that Hindsight had something to recall. That's the entire pitch for [agent memory](https://vectorize.io/what-is-agent-memory) in one before-and-after: the model is the same, the prompt is the same, the only variable is whether the agent has lived through this before.

This is what that looks like end-to-end in the dashboard — the learning-loop tracker across the top, the confidence score, and the memory panel on the right showing which memories were pulled in and marked as used:

![MemoryOps dashboard showing a 95% confidence diagnosis for a recurring payment gateway timeout, with the recalled memory marked as used](images/memoryops-dashboard.png)

And the negative-control case mattered just as much as the positive one. When I ran the payment-gateway-502 scenario against a memory bank full of Stripe-timeout incidents, the agent explicitly wrote: "memories describe undefined `STRIPE_API_URL` causing timeouts, which does not match the 502 Bad Gateway symptom observed here; therefore they are not relevant" — and set `usedMemoryIds` to an empty array. That's the behavior I actually needed. An agent that reuses every superficially similar memory is worse than an agent with no memory at all, because it fails confidently instead of failing honestly.

## Lessons learned

**Memory recall and relevance judgment are two different problems, and conflating them will burn you.** I originally tried to solve "is this memory actually relevant" by tuning similarity thresholds. It doesn't work, because relevance in an incident-response context depends on causal structure, not lexical or semantic overlap. Let recall be generous and let the reasoning step be the judge.

**Structured memory decomposition beats blob storage.** Hindsight splitting each incident into observation, world, and experience facts, with entity extraction attached, gave me something I could actually build a UI around. If your "memory" is just a big text chunk retrieved by cosine similarity, you can't show a user why a decision was made — you can only show them a wall of text and hope they trust you.

**Force the model to cite its sources.** Adding `usedMemoryIds` and `memoryAssessment` to the output schema cost almost nothing and changed the entire trust profile of the system. If you're building anything that recalls history, make citing that history a required field, not an afterthought.

**Retention should be a deliberate, human-gated step, not automatic.** I only write to memory once an engineer confirms the actual root cause and fix. Retaining unconfirmed guesses would poison the well — the whole point is that next time's diagnosis is only as good as this time's confirmed resolution.

**Read the [Hindsight docs](https://hindsight.vectorize.io/) before you design your prompts.** The retain and recall response shapes — reranker scores, entity graphs, memory types — are the raw material your reasoning layer works with. I designed my diagnosis prompt around the actual fields Hindsight returns, not around what I assumed a generic memory API would look like, and that's what made the "ignore this memory" behavior possible at all.

The part I keep coming back to is how unglamorous the fix was. I didn't need a bigger model or a cleverer prompt. I needed the agent to have actually lived through the failure once before — and a memory system that could hand that experience back in a form the model could reason about instead of just paste into its context window.
