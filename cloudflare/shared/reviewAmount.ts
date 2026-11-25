import { normalizeAmount } from "./numbers";

/** Parse area:category:ref_id, keeping colons inside the ref (e.g. 2026-10-14:gateway). */
export function exceptionIdParts(
  exceptionId: string,
): { area: string; category: string; ref_id: string } | null {
  const parts = String(exceptionId ?? "").split(":");
  if (parts.length < 3 || !parts[0] || !parts[1]) return null;
  return { area: parts[0], category: parts[1], ref_id: parts.slice(2).join(":") };
}

/** Pull a rupee amount from an action agent payload (top-level or actions[]). */
export function extractActionAmount(action: unknown): number | null {
  if (action == null) return null;
  let raw: unknown = action;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const direct = rec.amount ?? rec.recommended_amount ?? rec.recommendedAmount;
  if (direct != null && direct !== "") return normalizeAmount(direct);
  const actions = rec.actions;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  let sum = 0;
  let found = 0;
  for (const item of actions) {
    if (!item || typeof item !== "object") continue;
    const amt = (item as Record<string, unknown>).amount;
    if (amt == null || amt === "") continue;
    sum += normalizeAmount(amt);
    found += 1;
  }
  if (!found) return null;
  return normalizeAmount(sum);
}

/**
 * Canonical review "cost" / amount.
 * Prefer the book leakage on the exact exception row when that row exists
 * (including a genuine zero). Otherwise fall back to the action proposal.
 */
export function canonicalReviewAmount(opts: {
  leakage?: unknown;
  hasException?: boolean;
  action?: unknown;
}): number {
  const hasException =
    opts.hasException === true ||
    (opts.hasException !== false && opts.leakage != null && opts.leakage !== "");
  if (hasException) return normalizeAmount(opts.leakage);
  return extractActionAmount(opts.action) ?? 0;
}
