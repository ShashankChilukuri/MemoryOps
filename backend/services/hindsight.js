import "dotenv/config";
import { HindsightClient } from "@vectorize-io/hindsight-client";

const BANK = process.env.HINDSIGHT_BANK || "memoryops";

if (!process.env.HINDSIGHT_URL) {
  throw new Error("HINDSIGHT_URL is not set. Check backend/.env");
}

const client = new HindsightClient({
  baseUrl: process.env.HINDSIGHT_URL,
  apiKey: process.env.HINDSIGHT_API_KEY,
});
let bankReady = false;
async function ensureBank() {
  if (bankReady) return;
  try {
    await client.createBank(BANK, { name: "MemoryOps" });
  } catch (err) {
    // likely "already exists" - fine to ignore
    console.log("createBank note:", err.message);
  }
  bankReady = true;
}

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
    `Time to resolve: ${r.timeToResolveMins} minutes`,
  ].join("\n");
}

export async function retainIncident(incident) {
  await ensureBank();
  return client.retain(BANK, incidentToMemory(incident));
}

export async function recallSimilar(incident) {
  await ensureBank();
  const query = `${incident.title}. ${incident.service}. ${incident.logs.slice(0, 3).join(" ")}`;
  const result = await client.recall(BANK, query);
  console.log("RAW RECALL:", JSON.stringify(result, null, 2));
  return result;
}
export function simplifyMemories(recallResult, minScore = 0.3) {
  return (recallResult?.results || [])
    .filter((m) => (m.scores?.reranker ?? 0) >= minScore)
    .map((m) => ({
      id: m.id,
      type: m.type,
      text: m.text,
      relevance: Number((m.scores?.reranker ?? 0).toFixed(3)),
      entities: m.entities || [],
    }));
}