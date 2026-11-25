/** One-click "why" explainer for exceptions. */
import type { Context } from "hono";
import { getDb } from "./pg";
import { requireUser } from "./auth";

const CATEGORY_WHY: Record<string, string> = {
  expired_auth: "Authorization was approved but never captured before it expired. Leakage is the full auth amount.",
  auth_capture_mismatch: "Captured amount differs from authorized amount. Difference is treated as leakage.",
  scheme_fee_variance: "Actual scheme + interchange fees exceed the expected rate for the scheme.",
  missing_scheme_settlement: "Capture exists but no matching scheme settlement was received.",
  under_payout: "Merchant payout is less than the net amount after fees.",
  unmatched: "Record could not be matched to the expected counterpart.",
};

export async function handleWhy(c: Context) {
  requireUser(c);
  const id = c.req.param("id") || c.req.query("id") || "";
  if (!id) return c.json({ error: "id required" }, 400);
  const db = getDb(c.env);
  const row = await db
    .prepare("SELECT category, area, leakage, expected_amount, actual_amount, recon_ref FROM ra_exception_rows WHERE exception_id = ? OR ref_id = ? LIMIT 1")
    .bind(id, id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "not found" }, 404);
  const cat = String(row.category || "");
  const why = CATEGORY_WHY[cat] || `Exception in ${row.area}: ${cat}. Leakage of ₹${Number(row.leakage || 0).toFixed(2)} detected.`;
  return c.json({
    id,
    category: cat,
    area: row.area,
    leakage: row.leakage,
    expected: row.expected_amount,
    actual: row.actual_amount,
    recon_ref: row.recon_ref,
    why,
    recommendation: Number(row.leakage || 0) > 5000 ? "Escalate for review" : "Propose recovery or write-off",
  });
}
