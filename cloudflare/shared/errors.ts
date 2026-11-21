const SQLISH =
  /invalid input syntax|postgres|neon\s?db|sqlstate|sql error|\b22P0\d\b|column .* (?:is of type|does not exist)|relation ".*"|syntax error at or near|prepared statement|query failed|duplicate key value/i;

/** User-facing error; never echo raw SQL or driver messages. */
export function publicErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw) return fallback;
  if (SQLISH.test(raw) || /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(raw)) {
    return "The investigation couldn't be saved because an agent returned a value in an unexpected format. Please try again.";
  }
  if (/neuron|quota|rate limit|capacity|model.*(unavailable|overloaded)|workers ai/i.test(raw)) {
    return "The AI service is temporarily unavailable or over its daily limit. Please try again later.";
  }
  if (raw.length > 180) return fallback;
  return raw;
}
