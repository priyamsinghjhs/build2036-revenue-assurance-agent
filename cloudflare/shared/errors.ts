const SQLISH =
  /invalid input syntax|postgres|neon\s?db|sqlstate|sql error|\b22P0\d\b|column .* (?:is of type|does not exist)|relation ".*"|syntax error at or near|prepared statement|query failed|duplicate key value|numeric field overflow|value too long/i;

const PUBLIC_OK = [
  /^[A-Za-z0-9 _.'"\-]{3,180} (?:is|are) required\.?$/i,
  /is required/i,
  /must be (approved|rejected|done|accepted|dismissed|reinvestigate)/i,
  /comment is required/i,
  /not found/i,
  /only https destinations are allowed/i,
  /not allowed/i,
  /too many (login|requests|redirects)/i,
  /locked/i,
  /sign in/i,
  /invalid (json|decision|credentials|username or password)/i,
  /json object body required/i,
  /outside the revenue-assurance book/i,
  /cfo or admin approval required/i,
  /status must be/i,
  /decision must be/i,
  /question is required/i,
  /id is required/i,
];

export class AppError extends Error {
  status: number;
  expose: boolean;
  constructor(message: string, status = 400, expose = true) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.expose = expose;
  }
}

/** User-facing error; never echo raw SQL, driver, or unclassified messages. */
export function publicErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw) return fallback;
  if (err instanceof AppError && err.expose) return err.message;
  if (SQLISH.test(raw) || /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(raw)) {
    return "The investigation couldn't be saved because an agent returned a value in an unexpected format. Please try again.";
  }
  if (/neuron|quota|rate limit|capacity|model.*(unavailable|overloaded)|workers ai/i.test(raw)) {
    return "The AI service is temporarily unavailable or over its daily limit. Please try again later.";
  }
  if (/abort|timed out|timeout|failed to fetch|networkerror|network error|connection dropped|load failed/i.test(raw)) {
    return "The step timed out or the connection dropped. You can retry the remaining step.";
  }
  if (PUBLIC_OK.some((re) => re.test(raw)) && raw.length <= 180) return raw;
  return fallback;
}
