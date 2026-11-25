/** Basic free-tier file parsers for MT940 and camt.053. */
import type { Context } from "hono";
import { requireUser } from "./auth";

export function parseMt940(text: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const lines = text.split(/\r?\n/);
  let current: Record<string, unknown> = {};
  for (const line of lines) {
    if (line.startsWith(":61:")) {
      if (Object.keys(current).length) rows.push(current);
      current = { type: "mt940", raw: line.slice(4) };
    } else if (line.startsWith(":86:") && current.raw) {
      current.narrative = line.slice(4);
    }
  }
  if (Object.keys(current).length) rows.push(current);
  return rows;
}

export function parseCamt053(xml: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const amountRe = /<Amt[^>]*>([0-9.]+)<\/Amt>/g;
  let m;
  while ((m = amountRe.exec(xml))) {
    rows.push({ type: "camt053", amount: Number(m[1]), raw: m[0] });
  }
  return rows;
}

export async function handleIngestFile(c: Context) {
  const user = requireUser(c);
  const body = await c.req.json() as { format?: string; content?: string };
  const format = body.format || "mt940";
  const content = body.content || "";
  if (!content) return c.json({ error: "content required" }, 400);
  const rows = format === "camt053" || format === "camt.053"
    ? parseCamt053(content)
    : parseMt940(content);
  return c.json({ ok: true, format, row_count: rows.length, sample: rows.slice(0, 5), ingested_by: user.id });
}
