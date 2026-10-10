import "dotenv/config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are MemoryOps, a DevOps incident-response agent with long-term memory.
You receive a NEW incident (logs + context) and MEMORIES of past incidents recalled from your memory system.

Rules:
- Use memories ONLY if they match the new incident's symptoms AND context. A shared service name alone is not enough.
- Prefer fixes whose memory explicitly says they WORKED or were helpful.
- NEVER recommend a fix that a memory says DID NOT WORK or was rated NOT HELPFUL for the same symptoms.
- If memories describe a different root cause than current logs suggest or the fix did not work, do NOT reuse their fix. Document any such avoided fixes in "avoidedFixes".
- If no memory is relevant, diagnose from the logs alone and set usedMemoryIds to [] and confidence at most 60.
- Confidence (0-100) should be higher only when logs and a past successful incident clearly agree.
- Never invent past incidents or memory ids. In "usedMemoryIds", cite the exact id string (e.g. "45320595-74f9-45ea-bf22-fa66b627e9a4") from the RECALLED MEMORIES list.

Respond with ONLY a JSON object (no markdown, no preamble) in this shape:
{
  "probableCause": "string",
  "confidence": number,
  "suggestedFix": ["step 1", "step 2"],
  "reasoning": "short explanation referencing specific log lines",
  "usedMemoryIds": ["exact ids of memories that informed this"],
  "isRecurring": boolean,
  "memoryAssessment": "how the past incidents compare to this one, or why none were relevant",
  "avoidedFixes": ["explanation of fix chosen not to reuse and why"]
}`;

function buildUserPrompt(incident, memories) {
  const count = incident.eventCount || incident.logs?.length || 0;
  const mem = memories && memories.length
    ? memories
        .map((m, i) => `Memory [${i + 1}] (id: "${m.id}", type: ${m.type}, relevance: ${m.relevance}):\n${m.text}`)
        .join("\n\n")
    : "No relevant past memories were found.";

  return `NEW INCIDENT
Title: ${incident.title}
Service: ${incident.service}
Severity: ${incident.severity}
Events: ${count} events received, distinct messages shown below
Context: ${JSON.stringify(incident.context || {})}
Logs:
${(incident.logs || []).join("\n")}

RECALLED MEMORIES
${mem}`;
}

function parseAndCleanJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty response from Groq");
  }
  // Strip markdown code fences
  const stripped = rawText.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  // Extract first {...} block
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in LLM output");
  }
  const jsonStr = stripped.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonStr);
}

async function callGroqWithRetry(userPrompt) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 2500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        const isRetryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
        if (isRetryable && attempt < maxAttempts) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.warn(`Groq request failed with ${res.status}. Retrying in ${backoffMs}ms... (attempt ${attempt}/${maxAttempts})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw new Error(`Groq error ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return content;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && (err.name === "TimeoutError" || err.message?.includes("fetch failed"))) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        console.warn(`Groq connection error (${err.message}). Retrying in ${backoffMs}ms... (attempt ${attempt}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      if (attempt >= maxAttempts) break;
    }
  }

  throw lastError || new Error("Failed to communicate with Groq after retries");
}

export async function diagnoseIncident(incident, memories = []) {
  const userPrompt = buildUserPrompt(incident, memories);
  let rawContent;
  let parsed;

  // First attempt to get valid JSON, with one retry if parsing fails
  for (let jsonAttempt = 1; jsonAttempt <= 2; jsonAttempt++) {
    rawContent = await callGroqWithRetry(userPrompt);
    try {
      parsed = parseAndCleanJson(rawContent);
      break;
    } catch (parseErr) {
      if (jsonAttempt === 1) {
        console.warn("Groq output was not valid JSON, retrying once...", parseErr.message);
        continue;
      }
      throw new Error(`Failed to parse Groq response as JSON after retry: ${parseErr.message}`);
    }
  }

  // Guardrail enforcement in code
  const result = { ...parsed };

  // 1. Ensure array types
  if (!Array.isArray(result.suggestedFix)) {
    result.suggestedFix = result.suggestedFix ? [String(result.suggestedFix)] : [];
  }
  if (!Array.isArray(result.usedMemoryIds)) {
    result.usedMemoryIds = result.usedMemoryIds ? [String(result.usedMemoryIds)] : [];
  }
  if (!Array.isArray(result.avoidedFixes)) {
    result.avoidedFixes = result.avoidedFixes ? [String(result.avoidedFixes)] : [];
  }

  // 2. Validate usedMemoryIds against provided memories
  const providedIds = new Set((memories || []).map((m) => String(m.id)));
  const resolvedIds = result.usedMemoryIds.map((id) => {
    const idStr = String(id).trim();
    if (providedIds.has(idStr)) return idStr;
    const matchNum = idStr.match(/^#?(\d+)$/);
    if (matchNum) {
      const idx = parseInt(matchNum[1], 10) - 1;
      if (idx >= 0 && idx < memories.length && memories[idx]?.id) {
        return String(memories[idx].id);
      }
    }
    return idStr;
  });
  result.usedMemoryIds = resolvedIds.filter((id) => providedIds.has(String(id)));

  // 3. If no memories provided
  if (!memories || memories.length === 0) {
    result.usedMemoryIds = [];
    result.isRecurring = false;
    result.confidence = Math.min(Number(result.confidence) || 0, 60);
  } else {
    // 4. Set isRecurring true only if usedMemoryIds is not empty
    result.isRecurring = result.usedMemoryIds.length > 0;
  }

  // 5. Clamp confidence 0-100
  let conf = Number(result.confidence);
  if (isNaN(conf)) conf = 50;
  result.confidence = Math.max(0, Math.min(100, Math.round(conf)));

  // If no memories, reinforce 60 cap
  if (!memories || memories.length === 0) {
    result.confidence = Math.min(result.confidence, 60);
  }

  return result;
}

export default diagnoseIncident;