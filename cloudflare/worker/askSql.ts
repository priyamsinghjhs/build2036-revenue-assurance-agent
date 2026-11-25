import { ASK_VIEWS } from "./askTemplates";

/** Allow-list validator for Ask SQL (kept free of heavy imports so tests can load it). */
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set|execute|listen|notify|vacuum|refresh|comment|security|into|pg_|dblink|lo_|information_schema|pg_catalog)\b/i;

export function validateAskSql(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) throw new Error("A single SELECT statement is allowed");
  if (!/^\s*(with|select)\b/i.test(trimmed)) throw new Error("Only SELECT or WITH … SELECT is allowed");
  if (FORBIDDEN.test(trimmed)) throw new Error("Statement uses a disallowed keyword");
  const lower = trimmed.toLowerCase();
  const allow = ASK_VIEWS as readonly string[];
  const mentioned = allow.filter((v) => lower.includes(v));
  if (!mentioned.length) throw new Error(`Query must use an allow-listed view: ${allow.join(", ")}`);
  // Don't treat EXTRACT(... FROM ...), SUBSTRING(... FROM ...) as table references.
  const stripped = lower.replace(/\b(?:extract|substring|substr|overlay|trim)\s*\([^)]*\)/g, " ");
  const rels = [...stripped.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/g)].map((m) => m[1]);
  for (const rel of rels) {
    const base = rel.split(".").pop()!;
    if ((ASK_VIEWS as readonly string[]).includes(base) || mentioned.includes(base)) continue;
    throw new Error(`Relation ${rel} is not on the allow list`);
  }
  const limited = /\blimit\s+\d+\b/i.test(trimmed)
    ? trimmed.replace(/\blimit\s+(\d+)\b/i, (_, n) => `LIMIT ${Math.min(Number(n), 200)}`)
    : `${trimmed} LIMIT 200`;
  return limited;
}

