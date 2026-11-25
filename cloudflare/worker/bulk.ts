/** Bulk action skeleton for exceptions (maker-checker ready). */
import type { Context } from "hono";
import { getDb } from "./pg";
import { requireUser } from "./auth";
import { UPSERT_PROPOSED_ACTION_SQL } from "../shared/actionQueue";

export async function handleBulkAction(c: Context) {
  const user = requireUser(c);
  const body = await c.req.json() as { ids: string[]; action: string; comment?: string };
  if (!Array.isArray(body.ids) || !body.ids.length) {
    return c.json({ error: "ids required" }, 400);
  }
  const db = getDb(c.env);
  // Record pending proposals for maker-checker approval; idempotent per (exception, action).
  const now = new Date().toISOString();
  const action = String(body.action || "review").slice(0, 60);
  let queued = 0;
  for (const id of body.ids.slice(0, 100)) {
    await db
      .prepare(UPSERT_PROPOSED_ACTION_SQL)
      .bind(crypto.randomUUID(), `bulk:${user.id}`, String(id), action, 0, "INR", 0, (body.comment || `Bulk ${action}`).slice(0, 500), now)
      .run();
    queued++;
  }
  return c.json({ ok: true, queued });
}
