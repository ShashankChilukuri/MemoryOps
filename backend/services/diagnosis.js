import "dotenv/config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "meta-llama/llama-prompt-guard-2-22m" ;

const SYSTEM_PROMPT = `You are MemoryOps, a DevOps incident-response agent with long-term memory.
You receive a NEW incident (logs + context) and MEMORIES of past incidents recalled from your memory system.

Rules:
- Use memories ONLY if they match the new incident's symptoms AND context. A shared service name alone is not enough.
- If memories describe a different root cause than the current logs suggest, say so and do NOT reuse their fix.
- If no memory is relevant, diagnose from the logs alone and set usedMemoryIds to [] and confidence at most 60.
- Confidence (0-100) should be higher only when logs and a past incident clearly agree.
- Never invent past incidents. Only cite memory ids you were given.

Respond with ONLY a JSON object (no markdown, no preamble) in this shape:
{
  "probableCause": "string",
  "confidence": number,
  "suggestedFix": ["step 1", "step 2"],
  "reasoning": "short explanation referencing specific log lines",
  "usedMemoryIds": ["ids of memories that informed this"],
  "isRecurring": boolean,
  "memoryAssessment": "how the past incidents compare to this one, or why none were relevant"
}`;

function buildUserPrompt(incident, memories) {
  const mem = memories.length
    ? memories
        .map((m, i) => `[${i + 1}] id=${m.id} type=${m.type} relevance=${m.relevance}\n${m.text}`)
        .join("\n\n")
    : "No relevant past memories were found.";

  return `NEW INCIDENT
Title: ${incident.title}
Service: ${incident.service}
Severity: ${incident.severity}
Context: ${JSON.stringify(incident.context)}
Logs:
${incident.logs.join("\n")}

RECALLED MEMORIES
${mem}`;
}

export async function diagnoseIncident(incident, memories) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(incident, memories) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content;
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}