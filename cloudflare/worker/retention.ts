/** Data retention purge job (call from cron or admin). */
import type { Env } from "./types";
import { getDb } from "./pg";

export async function runRetention(env: Env) {
  const db = getDb(env);
  let purged = 0;
  try {
    const r1 = await db.prepare("DELETE FROM ra_login_attempts WHERE at < now() - interval '90 days'").run();
    purged += Number((r1 as any).meta?.changes ?? 0);
  } catch { /* table may not exist */ }
  try {
    const r2 = await db.prepare("DELETE FROM ra_audit_events WHERE at < now() - interval '2 years'").run();
    purged += Number((r2 as any).meta?.changes ?? 0);
  } catch { /* ignore */ }
  return { ok: true, purged, ran_at: new Date().toISOString() };
}
