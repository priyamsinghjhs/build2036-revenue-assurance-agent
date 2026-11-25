/** Bulk action skeleton for exceptions (maker-checker ready). */
import type { Context } from "hono";
import { getDb } from "./pg";
import { requireUser } from "./auth";

export async function handleBulkAction(c: Context) {
  const user = requireUser(c);
  const body = await c.req.json() as { ids: string[]; action: string; comment?: string };
  if (!Array.isArray(body.ids) || !body.ids.length) {
    return c.json({ error: "ids required" }, 400);
  }
  const db = getDb(c.env);
  // Placeholder: record bulk decision for later approval workflow
  const now = new Date().toISOString();
  for (const id of body.ids.slice(0, 100)) {
    await db.prepare(
      "INSERT INTO ra_action_queue (exception_id, action, status, proposed_by, proposed_at, comment) VALUES (?, ?, 'proposed', ?, ?, ?)"
    ).bind(id, body.action || "review", user.id, now, body.comment || null).run().catch(() => {});
  }
  return c.json({ ok: true, queued: body.ids.length });
}
