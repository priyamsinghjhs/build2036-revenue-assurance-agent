/** Parse messy LLM / UI numerics into a finite number, or null. */
export function parseLooseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return null;

  let s = value.trim();
  if (!s) return null;
  s = s.replace(/₹/g, "");
  s = s.replace(/\b(?:rs\.?|inr)\b/gi, "");
  s = s.replace(/,/g, "");
  s = s.replace(/\s+/g, " ").trim();

  let mul = 1;
  if (/\b(crore|cr)\b/i.test(s)) {
    mul = 10_000_000;
    s = s.replace(/\b(crore|cr)\b/gi, "");
  } else if (/\b(lakhs?|lacs?)\b/i.test(s) || /[lL]$/.test(s.trim())) {
    mul = 100_000;
    s = s.replace(/\b(lakhs?|lacs?)\b/gi, "").replace(/[lL]$/g, "");
  }
  s = s.replace(/%/g, "").trim();
  if (!s) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n * mul;
}

function hadPercent(value: unknown): boolean {
  return typeof value === "string" && value.includes("%");
}

/**
 * Confidence as an integer 0–100.
 * Accepts 90, "90", "90%", 0.9, "0.9". Fractions (0, 1] scale to percent
 * unless the source was already a percent string like "0.9%".
 */
export function normalizeConfidence(value: unknown): number {
  const n = parseLooseNumber(value);
  if (n == null) return 0;
  let pct = n;
  if (!hadPercent(value) && pct > 0 && pct <= 1) pct = pct * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Money amount: strip currency and grouping, expand L/lakh (and crore). */
export function normalizeAmount(value: unknown): number {
  const n = parseLooseNumber(value);
  if (n == null) return 0;
  return Math.round(n * 100) / 100;
}


/** Display confidence as a clamped integer percent, e.g. 70% — never 7000%. */
export function formatConfidence(value: unknown): string {
  return `${normalizeConfidence(value)}%`;
}
