export function normalizeSignature(message) {
  if (!message || typeof message !== "string") return "";
  let s = message;
  // 1. Strip timestamps (ISO 8601, date, time)
  s = s.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gi, " ");
  s = s.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  s = s.replace(/\d{2}:\d{2}:\d{2}(?:\.\d+)?/g, " ");
  // 2. Strip UUIDs
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ");
  // 3. Strip all digits
  s = s.replace(/\d+/g, "");
  // 4. Lowercase
  s = s.toLowerCase();
  // 5. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export const getSignature = normalizeSignature;
export default normalizeSignature;
