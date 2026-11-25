/**
 * Compact, columnar context for Workers AI prompts.
 * Avoid mid-JSON truncation and drop heavy fields (SHAP, embeddings, raw trees).
 */
const DROP = new Set([
  "shap",
  "shap_values",
  "global_shap",
  "top_factors",
  "top_shap",
  "embedding",
  "embeddings",
  "tree",
  "trees",
  "audit_trail",
]);

const MAX_ROWS = 24;
const MAX_CHARS = 4000;

export const NARRATIVE_MAX_TOKENS = 384;

export function stripHeavy(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== "object") return value;
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ROWS).map((v) => stripHeavy(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP.has(k) || /shap/i.test(k)) continue;
    out[k] = stripHeavy(v, depth + 1);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 16);
  const header = keys.join("\t");
  const body = rows.slice(0, MAX_ROWS).map((r) =>
    keys
      .map((k) => {
        const v = r[k];
        if (v == null) return "";
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      })
      .join("\t"),
  );
  const extra = rows.length > MAX_ROWS ? `\n# +${rows.length - MAX_ROWS} more rows omitted` : "";
  return [header, ...body].join("\n") + extra;
}

export function toColumnar(value: unknown, title = "INPUT"): string {
  const cleaned = stripHeavy(value);
  const lines: string[] = [`# ${title}`];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v) && v.every((x) => isPlainObject(x))) {
      lines.push(`## ${path || "rows"}`);
      lines.push(table(v as Record<string, unknown>[]));
      return;
    }
    if (Array.isArray(v)) {
      lines.push(`## ${path || "list"}`);
      lines.push(v.map((x) => (typeof x === "object" ? JSON.stringify(stripHeavy(x)) : String(x))).join("\n"));
      return;
    }
    if (isPlainObject(v)) {
      const scalars: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) {
        if (child && typeof child === "object") walk(child, path ? `${path}.${k}` : k);
        else scalars[k] = child;
      }
      if (Object.keys(scalars).length) {
        lines.push(`## ${path || "fields"}`);
        lines.push(table([scalars]));
      }
      return;
    }
    if (v != null) lines.push(String(v));
  };
  walk(cleaned, "");
  return lines.filter(Boolean).join("\n");
}

export function compactContext(value: unknown, maxChars = MAX_CHARS, title = "INPUT"): string {
  const text = toColumnar(value, title);
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let n = 0;
  for (const line of lines) {
    if (n + line.length + 1 > maxChars - 32) break;
    kept.push(line);
    n += line.length + 1;
  }
  kept.push("# context truncated by row, not mid-line");
  return kept.join("\n");
}
