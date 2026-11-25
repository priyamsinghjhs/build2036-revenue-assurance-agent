/**
 * Deterministic grounding / faithfulness check for LLM agent outputs.
 * Every number, amount, ID, date and merchant/entity in the output must appear
 * in (or be derivable from) the context that was passed to the model.
 * No extra LLM call is made here — an optional judge would spend free neurons.
 */

export type GroundingClaim = {
  kind: "number" | "id" | "date" | "entity";
  value: string;
  supported: boolean;
};

export type GroundingResult = {
  claims: number;
  supported: number;
  faithfulness: number;
  unsupported: GroundingClaim[];
  passed: boolean;
  /** Hypotheses and tagged recommendations, scored separately — not in faithfulness. */
  hypothesis?: { claims: number; supported: number; faithfulness: number; unsupported: GroundingClaim[] };
};

const GENERIC_NUM = new Set(["0", "0.0", "0.00", "0.0000", "1", "2", "3", "4", "5", "10", "100"]);
const STOP_IDS = new Set([
  "INR", "USD", "EUR", "SQL", "JSON", "HIGH", "LOW", "MEDIUM", "CRITICAL", "WATCH",
  "GOOD", "POOR", "YES", "NO", "THE", "AND", "FOR", "FROM", "WITH", "CASE", "WHEN",
  "THEN", "ELSE", "END", "CAST", "TRUE", "FALSE", "NULL", "UPI", "CARD", "NEFT",
  "P2M", "P2P", "PPI", "GST", "TDS", "MDR", "SLA", "CFO", "RAG", "LLM", "API",
  "TREAT", "TREATS", "TREATMENT", "DRAFT",
]);

/**
 * Numbers with Western (1,234,567.89) or Indian (12,34,567.89) digit grouping.
 * Without the Indian form, "₹9,94,298.01" was read as 9 and 94,298.01 and the
 * second half was scored as a hallucination.
 */
export const NUMBER_RE_SOURCE = String.raw`-?(?:\d{1,2}(?:,\d{2})+,\d{3}|\d+(?:,\d{3})*)(?:\.\d+)?`;

function tokenizeContext(context: string): { text: string; numbers: number[] } {
  const text = context.toUpperCase();
  const numbers: number[] = [];
  const re = new RegExp(NUMBER_RE_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(context))) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) numbers.push(n);
  }
  const derived: number[] = [...numbers];
  const cap = Math.min(numbers.length, 24);
  for (let i = 0; i < cap; i++) {
    for (let j = i + 1; j < cap; j++) {
      derived.push(numbers[i] + numbers[j]);
      derived.push(Math.abs(numbers[i] - numbers[j]));
      derived.push(numbers[i] * numbers[j]);
      if (numbers[j] !== 0) derived.push(numbers[i] / numbers[j]);
      if (numbers[i] !== 0) derived.push(numbers[j] / numbers[i]);
    }
  }
  return { text, numbers: derived };
}

function closeTo(n: number, pool: number[]): boolean {
  for (const p of pool) {
    if (Math.abs(p - n) <= 0.015) return true;
    if (p !== 0 && Math.abs(p - n) / Math.abs(p) <= 0.002) return true;
    // bps / percent forms: 0.0015 vs 15, 0.35 vs 35
    if (Math.abs(p * 100 - n) <= 0.05 || Math.abs(p * 10000 - n) <= 0.5) return true;
    if (Math.abs(n * 100 - p) <= 0.05 || Math.abs(n * 10000 - p) <= 0.5) return true;
  }
  return false;
}

function extractClaims(output: unknown): GroundingClaim[] {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const seen = new Set<string>();
  const claims: GroundingClaim[] = [];
  const add = (kind: GroundingClaim["kind"], value: string) => {
    const key = `${kind}:${value.toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, value, supported: false });
  };

  const numRe = new RegExp(NUMBER_RE_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(text))) {
    const raw = m[0];
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const abs = Math.abs(n);
    if (GENERIC_NUM.has(String(n)) || GENERIC_NUM.has(raw)) continue;
    // skip lone years unless we treat them as dates below
    if (abs >= 2020 && abs <= 2035 && !raw.includes(".")) continue;
    // skip 0-100 integers that are likely confidence / rates when they have no decimals and are small
    if (Number.isInteger(n) && abs <= 100 && !raw.includes(".")) continue;
    add("number", raw.replace(/,/g, ""));
  }

  const dateRe = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi;
  while ((m = dateRe.exec(text))) add("date", m[0]);

  const idRe = /\b(?:MER|CAP|ACQ|PAR|DOC|RULE|CTL|ANOM|CAN|TXN|UPI|INV|E2E|IPM|VISA|CAMT|ING|RSK|APM|TRS|TRX)(?:-[A-Z0-9:_-]+|\d[A-Z0-9:_-]*)\b|\b[A-Z]{2,8}-\d[A-Z0-9:_-]*\b|\b[A-Z]{2,5}\d{3,}\b|\b[a-z]+(?::[a-z0-9_]+){2,}\b/gi;
  while ((m = idRe.exec(text))) {
    const v = m[0];
    if (STOP_IDS.has(v.toUpperCase())) continue;
    if (v.length < 4) continue;
    if (/^(sug|suggestion|check|item|rec|act)-\d+$/i.test(v)) continue;
    add("id", v);
  }

  const entRe = /\b(?:PayStreet|QuickMart|HDFC|ICICI|RuPay|Mastercard|Visa|Innoviti|INTERMEDIARY-[A-Z]+)\b/gi;
  while ((m = entRe.exec(text))) add("entity", m[0]);

  return claims;
}


const HYPOTHESIS_KEYS = new Set([
  "hypothesis", "hypotheses", "hunch", "possible_cause", "possible_causes", "hunches",
]);

/** Runtime telemetry and self-scores are not book facts. */
const META_KEYS = new Set([
  "timing", "latency", "usage", "tokens", "neon_ms", "ai_ms", "total_ms",
  "cache_hit", "retries", "source", "verification", "faithfulness",
  "unsupported", "claims", "supported", "error", "model",
  "prompt_tokens", "completion_tokens", "eval_id",
  // Echoes of an earlier check's rejected claims are a log, not new claims.
  "unsupported_claims", "post_check_removed", "hypothesis_claims", "hypothesis_faithfulness",
]);

/** Advice / hypothesis sentences that start with these tags are not scored as facts. */
export const SENTENCE_TAG_RE = /^\s*(?:\[(?:recommendation|hypothesis)\]|Recommendation:|Hypothesis:)\s*/i;

function splitSentences(text: string): string[] {
  return String(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pull tagged recommendation/hypothesis sentences out of strings and nested objects. */
export function peelTaggedProse(value: unknown): { factual: unknown; tagged: unknown } {
  if (typeof value === "string") {
    const factual: string[] = [];
    const tagged: string[] = [];
    for (const s of splitSentences(value)) {
      (SENTENCE_TAG_RE.test(s) ? tagged : factual).push(s);
    }
    return { factual: factual.join(" "), tagged: tagged.join(" ") || null };
  }
  if (Array.isArray(value)) {
    const factual: unknown[] = [];
    const tagged: unknown[] = [];
    for (const item of value) {
      const p = peelTaggedProse(item);
      if (p.factual !== "" && p.factual != null && !(Array.isArray(p.factual) && (p.factual as unknown[]).length === 0)) {
        factual.push(p.factual);
      }
      if (p.tagged) tagged.push(p.tagged);
    }
    return { factual, tagged: tagged.length ? tagged : null };
  }
  if (value && typeof value === "object") {
    const factual: Record<string, unknown> = {};
    const tagged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = peelTaggedProse(v);
      if (p.factual !== "" && p.factual != null) factual[k] = p.factual;
      if (p.tagged) tagged[k] = p.tagged;
    }
    return { factual, tagged: Object.keys(tagged).length ? tagged : null };
  }
  return { factual: value, tagged: null };
}

/** Split facts from labelled hypotheses / recommendation-only suggestions. */
export function splitFactualOutput(output: unknown): { factual: unknown; hypotheses: unknown } {
  if (output == null || typeof output !== "object" || Array.isArray(output)) {
    return { factual: output, hypotheses: null };
  }
  const rec = output as Record<string, unknown>;
  const factual: Record<string, unknown> = {};
  const hypotheses: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (META_KEYS.has(k.toLowerCase())) continue;
    if (HYPOTHESIS_KEYS.has(k.toLowerCase())) {
      hypotheses[k] = v;
      continue;
    }
    if (k === "suggestions" && Array.isArray(v)) {
      const factSugs: unknown[] = [];
      const recSugs: unknown[] = [];
      for (const item of v) {
        if (item && typeof item === "object") {
          const s = item as Record<string, unknown>;
          const kind = String(s.kind ?? "");
          const rationale = String(s.rationale ?? s.reason ?? s.why ?? "");
          if (kind === "recommendation" || /^hypothesis\b/i.test(rationale) || /is not proven/i.test(rationale)) {
            recSugs.push(item);
            continue;
          }
        }
        factSugs.push(item);
      }
      factual.suggestions = factSugs;
      if (recSugs.length) hypotheses.recommendations = recSugs;
      continue;
    }
    factual[k] = v;
  }
  const peeled = peelTaggedProse(factual);
  const factualOut = peeled.factual;
  if (peeled.tagged) {
    const existing = hypotheses.tagged_sentences;
    hypotheses.tagged_sentences = existing
      ? [existing, peeled.tagged]
      : peeled.tagged;
  }
  return { factual: factualOut, hypotheses: Object.keys(hypotheses).length ? hypotheses : null };
}

/** GroundedNumbers must be 1.0 — every extracted number/ID/date/entity is in the context. */
export const GROUNDED_REQUIRED = 1.0;

function scoreAgainstContext(output: unknown, ctxStr: string, threshold: number): GroundingResult {
  const { text, numbers } = tokenizeContext(ctxStr);
  const claims = extractClaims(output);
  for (const c of claims) {
    if (c.kind === "number") {
      const n = Number(c.value);
      // Display text writes negatives with a minus sign or as a plain magnitude.
      c.supported = closeTo(n, numbers) || closeTo(-n, numbers) || text.includes(c.value.toUpperCase());
    } else {
      const needle = c.value.toUpperCase().replace(/-/g, "");
      const hay = text.replace(/-/g, "");
      c.supported = hay.includes(c.value.toUpperCase()) || hay.includes(needle);
    }
  }
  const supported = claims.filter((c) => c.supported).length;
  const faithfulness = claims.length === 0 ? 1 : supported / claims.length;
  const unsupported = claims.filter((c) => !c.supported);
  const critical = unsupported.filter((c) => c.kind === "id" || c.kind === "number" || c.kind === "entity");
  const passed = faithfulness >= threshold && unsupported.length === 0 && critical.length === 0;
  return { claims: claims.length, supported, faithfulness, unsupported, passed };
}

export function checkGrounding(output: unknown, context: unknown, threshold = GROUNDED_REQUIRED): GroundingResult {
  const ctxStr = typeof context === "string" ? context : JSON.stringify(context);
  const { factual, hypotheses } = splitFactualOutput(output);
  const result = scoreAgainstContext(factual, ctxStr, threshold);
  if (hypotheses) {
    const hyp = scoreAgainstContext(hypotheses, ctxStr, 0);
    result.hypothesis = { claims: hyp.claims, supported: hyp.supported, faithfulness: hyp.faithfulness, unsupported: hyp.unsupported };
  }
  return result;
}

export function retryPrompt(unsupported: GroundingClaim[]): string {
  const list = unsupported.map((c) => `${c.kind} "${c.value}"`).join(", ");
  return [
    "GROUNDING REWORK: your previous JSON used claims that are not in the INPUT context:",
    list || "(unspecified)",
    "Rewrite the same schema using ONLY facts from INPUT.",
    "If a number, ID, date or merchant is not in the context, write \"insufficient data\" and omit the invented value.",
    "Do not invent or round-up figures. Return JSON only.",
  ].join("\n");
}
