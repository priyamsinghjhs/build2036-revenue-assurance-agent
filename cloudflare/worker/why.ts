/** One-click "why" explainer for exceptions. */
import type { Context } from "hono";
import { getDb } from "./pg";
import { requireUser } from "./auth";
import { exceptionIdParts } from "../shared/reviewAmount";
import { assertRecordVisible } from "./scopeAccess";
import { areaFromExceptionId } from "../shared/scope";

const CATEGORY_WHY: Record<string, string> = {
  expired_auth: "Authorization was approved but never captured before it expired. Leakage is the full auth amount.",
  auth_capture_mismatch: "Captured amount differs from authorized amount. Difference is treated as leakage.",
  scheme_fee_variance: "Actual scheme + interchange fees exceed the expected rate for the scheme.",
  missing_scheme_settlement: "Capture exists but no matching scheme settlement was received.",
  under_payout: "Merchant payout is less than the net amount after fees.",
  unmatched: "Record could not be matched to the expected counterpart.",
};

export async function handleWhy(c: Context) {
  const user = requireUser(c);
  const id = c.req.param("id") || c.req.query("id") || "";
  if (!id) return c.json({ error: "id required" }, 400);
  const db = getDb(c.env);
  // ra_exception_rows has no exception_id column: the id is area:category:ref_id.
  const parts = exceptionIdParts(id);
  if (parts) await assertRecordVisible(db, user, { type: "exception", id, area: areaFromExceptionId(id) });
  const row = parts
    ? await db
        .prepare("SELECT category, area, ref_id, leakage, expected_amount, actual_amount, recon_ref FROM ra_exception_rows WHERE area = ? AND category = ? AND ref_id = ? LIMIT 1")
        .bind(parts.area, parts.category, parts.ref_id)
        .first<Record<string, unknown>>()
    : await db
        .prepare("SELECT category, area, ref_id, leakage, expected_amount, actual_amount, recon_ref FROM ra_exception_rows WHERE ref_id = ? LIMIT 1")
        .bind(id)
        .first<Record<string, unknown>>();
  if (row && !parts) {
    await assertRecordVisible(db, user, { type: "exception", id: `${row.area}:${row.category}:${row.ref_id}`, area: String(row.area) });
  }
  if (!row) return c.json({ error: "not found" }, 404);
  const cat = String(row.category || "");
  const why = CATEGORY_WHY[cat] || `Exception in ${row.area}: ${cat}. Leakage of ₹${Number(row.leakage || 0).toFixed(2)} detected.`;
  return c.json({
    id,
    category: cat,
    area: row.area,
    leakage: Number(row.leakage ?? 0),
    expected: row.expected_amount == null ? null : Number(row.expected_amount),
    actual: row.actual_amount == null ? null : Number(row.actual_amount),
    recon_ref: row.recon_ref,
    why,
    recommendation: Number(row.leakage || 0) > 5000 ? "Escalate for review" : "Propose recovery or write-off",
  });
}
