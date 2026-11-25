/** Configurable recon rules API. */
import type { Context } from "hono";
import { getDb } from "./pg";
import { requireUser } from "./auth";

export async function listRules(c: Context) {
  requireUser(c);
  const db = getDb(c.env);
  const { results } = await db.prepare("SELECT * FROM ra_recon_rules WHERE enabled = true ORDER BY domain, category").all();
  return c.json({ rules: results ?? [] });
}

export async function upsertRule(c: Context) {
  const user = requireUser(c);
  const body = await c.req.json() as Record<string, unknown>;
  const domain = String(body.domain || "");
  const category = String(body.category || "");
  if (!domain || !category) return c.json({ error: "domain and category required" }, 400);
  const db = getDb(c.env);
  await db.prepare(
    `INSERT INTO ra_recon_rules (domain, category, tolerance_bps, tolerance_amount, auto_writeoff_threshold, description, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (domain, category) DO UPDATE SET
       tolerance_bps = EXCLUDED.tolerance_bps,
       tolerance_amount = EXCLUDED.tolerance_amount,
       auto_writeoff_threshold = EXCLUDED.auto_writeoff_threshold,
       description = EXCLUDED.description,
       updated_at = now()`
  ).bind(
    domain,
    category,
    Number(body.tolerance_bps ?? 0),
    Number(body.tolerance_amount ?? 0),
    Number(body.auto_writeoff_threshold ?? 0),
    String(body.description || "")
  ).run();
  return c.json({ ok: true, domain, category, updated_by: user.id });
}
