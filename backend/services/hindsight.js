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
  const r = incident.resolution || {};
  let outcomeSentence = `Outcome: ${r.outcome}`;
  if (r.outcome === "worked") {
    outcomeSentence = "This fix WORKED.";
  } else if (r.outcome === "partially_worked" || r.outcome === "partly") {
    outcomeSentence = "This fix PARTIALLY worked.";
  } else if (r.outcome === "did_not_work" || r.outcome === "not_helpful") {
    outcomeSentence = "This fix DID NOT WORK. Do not recommend it for this symptom.";
  }

  return [
    `Incident: ${incident.title}`,
    `Service: ${incident.service} | Severity: ${incident.severity}`,
    `Symptoms (logs): ${(incident.logs || []).join(" || ")}`,
    `Context: ${JSON.stringify(incident.context || {})}`,
    `Root cause: ${r.rootCause}`,
    `Fix applied: ${r.fixApplied}`,
    outcomeSentence,
    `Time to resolve: ${r.timeToResolveMins} minutes`,
  ].join("\n");
}

export async function retainIncident(incident) {
  await ensureBank();
  return client.retain(BANK, incidentToMemory(incident));
}

export async function retainFeedback(incident, rating, note) {
  await ensureBank();
  let ratingSentence = "";
  if (rating === "helpful") {
    ratingSentence = "The engineer rated the suggested fix HELPFUL: it matched the real cause and fixed the issue.";
  } else if (rating === "partly") {
    ratingSentence = "The engineer rated the suggested fix PARTIALLY HELPFUL.";
  } else if (rating === "not_helpful") {
    ratingSentence = "The engineer rated the suggested fix NOT HELPFUL: it did not match the real cause. Do not recommend it again for these symptoms.";
  } else {
    ratingSentence = `The engineer rated the suggested fix: ${rating}.`;
  }
  if (note) {
    ratingSentence += ` Note: ${note}`;
  }

  const fixSteps = Array.isArray(incident.diagnosis?.suggestedFix)
    ? incident.diagnosis.suggestedFix.join("; ")
    : (incident.diagnosis?.suggestedFix || "None");

  const memoryText = [
    `Incident: ${incident.title}`,
    `Service: ${incident.service} | Severity: ${incident.severity}`,
    `Symptoms (logs): ${(incident.logs || []).slice(0, 5).join(" || ")}`,
    `Suggested cause: ${incident.diagnosis?.probableCause || "Unknown"}`,
    `Suggested fix: ${fixSteps}`,
    ratingSentence,
  ].join("\n");

  return client.retain(BANK, memoryText);
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
    .filter((m) => {
      const score = m.scores?.reranker ?? m.scores?.final ?? m.scores?.semantic ?? 0;
      return score >= minScore;
    })
    .map((m) => {
      const score = m.scores?.reranker ?? m.scores?.final ?? m.scores?.semantic ?? 0;
      return {
        id: m.id,
        type: m.type,
        text: m.text,
        relevance: Number(score.toFixed(3)),
        entities: m.entities || [],
      };
    })
    .sort((a, b) => b.relevance - a.relevance);
}