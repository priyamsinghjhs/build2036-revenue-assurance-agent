/**
 * Incremental daily recon.
 *
 * Reconciles one day at a time. A day is skipped when its source hash matches
 * the watermark, so the whole period is not re-run unless prior days changed.
 */
import { getDb, type AppDb } from "./pg";
import type { Env } from "./types";

export type DayResult = {
  area: string;
  recon_date: string;
  skipped: boolean;
  exception_count: number;
  leakage: number;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function sourceHash(db: AppDb, area: string, date: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT md5(COALESCE(string_agg(recon_ref || ':' || COALESCE(status,''), ',' ORDER BY recon_ref), '')) AS h,
              COUNT(*)::int AS n
       FROM ra_authorizations
       WHERE ts::date = ?::date AND ($2 = 'all' OR merchant_id IS NOT NULL)`,
    )
    .bind(date, area)
    .first<{ h: string | null; n: number }>()
    .catch(() => null);
  return row?.h || `${area}:${date}:empty`;
}

async function watermark(db: AppDb, area: string, date: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT source_hash FROM ra_recon_watermark WHERE area = ? AND recon_date = ?::date")
    .bind(area, date)
    .first<{ source_hash: string | null }>()
    .catch(() => null);
  return row?.source_hash ?? null;
}

/**
 * Reconcile a single day for an area. Skips when the source hash is unchanged.
 */
export async function reconcileDay(env: Env, area: string, date: string): Promise<DayResult> {
  const db = getDb(env);
  const hash = await sourceHash(db, area, date);
  const prev = await watermark(db, area, date);
  if (prev && prev === hash) {
    return { area, recon_date: date, skipped: true, exception_count: 0, leakage: 0 };
  }

  const summary = await db
    .prepare(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage
       FROM ra_exception_rows
       WHERE area = ? AND ts::date = ?::date`,
    )
    .bind(area, date)
    .first<{ n: number; leakage: number }>()
    .catch(() => ({ n: 0, leakage: 0 }));

  await db
    .prepare(
      `INSERT INTO ra_recon_watermark (area, recon_date, source_hash, exception_count, leakage, reconciled_at)
       VALUES (?, ?::date, ?, ?, ?, now())
       ON CONFLICT (area, recon_date) DO UPDATE SET
         source_hash = EXCLUDED.source_hash,
         exception_count = EXCLUDED.exception_count,
         leakage = EXCLUDED.leakage,
         reconciled_at = now()`,
    )
    .bind(area, date, hash, summary?.n ?? 0, summary?.leakage ?? 0)
    .run()
    .catch(() => undefined);

  return {
    area,
    recon_date: date,
    skipped: false,
    exception_count: summary?.n ?? 0,
    leakage: summary?.leakage ?? 0,
  };
}

/**
 * Reconcile a range of days, stopping early when consecutive days are unchanged.
 * Default window is the last 7 days. Pass force=true to ignore watermarks.
 */
export async function reconcileRange(
  env: Env,
  opts: { area?: string; from?: string; to?: string; force?: boolean } = {},
): Promise<{ days: DayResult[]; skipped: number; ran: number }> {
  const area = opts.area || "all";
  const end = opts.to ? new Date(opts.to) : new Date();
  const start = opts.from ? new Date(opts.from) : new Date(end.getTime() - 6 * 86400_000);
  const days: DayResult[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    if (opts.force) {
      const db = getDb(env);
      await db.prepare("DELETE FROM ra_recon_watermark WHERE area = ? AND recon_date = ?::date").bind(area, key).run().catch(() => undefined);
    }
    days.push(await reconcileDay(env, area, key));
  }
  return {
    days,
    skipped: days.filter((d) => d.skipped).length,
    ran: days.filter((d) => !d.skipped).length,
  };
}
