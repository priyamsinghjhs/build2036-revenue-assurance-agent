import type { Context } from "hono";
import { getDb } from "./pg";
import type { Env } from "./types";

/** Expected schema version. Bump when a migration that changes required tables lands. */
export const EXPECTED_SCHEMA_VERSION = 36;

/**
 * Public readiness probe. Returns 200 only when the database is reachable
 * and a required table from the expected schema exists. Detailed diagnostics
 * stay behind authenticated routes.
 */
export async function handleHealthz(c: Context<{ Bindings: Env }>) {
  try {
    const db = getDb(c.env);
    // Probe a table that exists from early migrations and is still required.
    const row = await db
      .prepare("SELECT 1 AS ok FROM ra_exceptions LIMIT 1")
      .first<{ ok: number }>()
      .catch(() => null);
    if (!row) {
      return c.json({ ok: false, reason: "schema" }, 503);
    }
    return c.json({ ok: true }, 200);
  } catch {
    return c.json({ ok: false, reason: "database" }, 503);
  }
}

/** Authenticated detailed health. Not for public probes. */
export async function handleHealthDetail(c: Context<{ Bindings: Env }>) {
  try {
    const db = getDb(c.env);
    const started = Date.now();
    await db.prepare("SELECT 1").first();
    const latency_ms = Date.now() - started;
    return c.json({
      ok: true,
      synthetic: true,
      schema_version: EXPECTED_SCHEMA_VERSION,
      latency_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 503);
  }
}
