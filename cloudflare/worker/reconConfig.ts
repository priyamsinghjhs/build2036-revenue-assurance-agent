/**
 * Versioned recon rule configuration with maker-checker.
 * - Recon reads the active version at run time (isolate cache, 30s).
 * - Admin (settings) proposes; a different user with approve_review approves.
 * - Every proposal and decision is written to ra_recon_rule_audit (who, when, old -> new).
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppDb } from "./pg";
import { getDb } from "./pg";
import { requireUser } from "./auth";
import { hasPermission } from "../shared/roles";
import {
  CONFIG_AREAS,
  DEFAULT_RECON_CONFIG,
  LIMITS,
  MATCHING_KEY_COLUMNS,
  diffReconConfig,
  validateReconConfig,
  type ReconRuleConfig,
} from "../shared/reconConfig";

const TTL_MS = 30_000;
let cache: { at: number; version: number; config: ReconRuleConfig } | null = null;

export function clearReconConfigCache() {
  cache = null;
}

function parseConfig(raw: unknown): ReconRuleConfig {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  const v = validateReconConfig(obj);
  return v.ok ? v.config : DEFAULT_RECON_CONFIG;
}

/** Active config. Falls back to the defaults (version 0) if the table is missing, so recon never breaks. */
export async function activeReconConfig(db: AppDb): Promise<{ version: number; config: ReconRuleConfig }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { version: cache.version, config: cache.config };
  try {
    const row = await db
      .prepare("SELECT version, config FROM ra_recon_rule_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1")
      .first<{ version: number; config: unknown }>();
    const value = row ? { version: Number(row.version), config: parseConfig(row.config) } : { version: 0, config: DEFAULT_RECON_CONFIG };
    cache = { at: Date.now(), ...value };
    return value;
  } catch {
    return { version: 0, config: DEFAULT_RECON_CONFIG };
  }
}

export async function getRules(c: Context) {
  requireUser(c);
  const db = getDb(c.env);
  clearReconConfigCache();
  const active = await activeReconConfig(db);
  const { results } = await db
    .prepare(
      `SELECT version, status, config, note, proposed_by, proposed_at, base_version
       FROM ra_recon_rule_versions WHERE status = 'proposed' ORDER BY version DESC LIMIT 20`,
    )
    .all<Record<string, unknown>>();
  const activeMeta = await db
    .prepare("SELECT proposed_by, decided_by, decided_at FROM ra_recon_rule_versions WHERE version = ?")
    .bind(active.version)
    .first<Record<string, unknown>>()
    .catch(() => null);
  return c.json({
    active: { ...active, ...(activeMeta ?? {}) },
    proposals: (results ?? []).map((r) => {
      const cfg = parseConfig(r.config);
      return { ...r, config: cfg, changes: diffReconConfig(active.config, cfg) };
    }),
    defaults: DEFAULT_RECON_CONFIG,
    limits: LIMITS,
    areas: CONFIG_AREAS,
    matching_key_columns: MATCHING_KEY_COLUMNS,
  });
}

export async function getRuleHistory(c: Context) {
  requireUser(c);
  const { results } = await getDb(c.env)
    .prepare(
      `SELECT id, version, action, actor, role, at, changes, note FROM ra_recon_rule_audit ORDER BY at DESC, id DESC LIMIT 100`,
    )
    .all<Record<string, unknown>>();
  return c.json({
    history: (results ?? []).map((r) => ({ ...r, changes: typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes ?? [] })),
  });
}

export async function proposeRules(c: Context) {
  const user = requireUser(c);
  if (!hasPermission(user.role, "settings")) throw new HTTPException(403, { message: "Only an admin can propose rule changes." });
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateReconConfig(body.config);
  if (!v.ok) return c.json({ error: "Invalid rule config", errors: v.errors }, 400);
  const db = getDb(c.env);
  clearReconConfigCache();
  const active = await activeReconConfig(db);
  const base = Number(body.base_version ?? active.version);
  if (base !== active.version) {
    return c.json({ error: `Stale edit: active version is ${active.version}, you edited ${base}. Reload and retry.` }, 409);
  }
  const changes = diffReconConfig(active.config, v.config);
  if (!changes.length) return c.json({ error: "No change from the active rules." }, 400);
  const note = String(body.note || "").slice(0, 500);
  if (!note.trim()) return c.json({ error: "A reason (note) is required." }, 400);
  const row = await db
    .prepare(
      `WITH ins AS (
         INSERT INTO ra_recon_rule_versions (version, status, config, note, proposed_by, base_version)
         SELECT COALESCE(MAX(version), 0) + 1, 'proposed', ?::jsonb, ?::text, ?::text, ?::int FROM ra_recon_rule_versions
         RETURNING version
       ), aud AS (
         INSERT INTO ra_recon_rule_audit (version, action, actor, role, old_config, new_config, changes, note)
         SELECT version, 'proposed', ?::text, ?::text, ?::jsonb, ?::jsonb, ?::jsonb, ?::text FROM ins RETURNING id
       )
       SELECT ins.version FROM ins`,
    )
    .bind(
      JSON.stringify(v.config), note, user.id, active.version,
      user.id, user.role, JSON.stringify(active.config), JSON.stringify(v.config), JSON.stringify(changes), note,
    )
    .first<{ version: number }>();
  return c.json({ ok: true, version: Number(row?.version), status: "proposed", changes, needs_approval_by: "a different user with approve_review (CFO, auditor or admin)" }, 201);
}

export async function decideRules(c: Context) {
  const user = requireUser(c);
  if (!hasPermission(user.role, "approve_review")) throw new HTTPException(403, { message: "You cannot approve rule changes." });
  const version = Number(c.req.param("version"));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = String(body.decision || "");
  if (decision !== "approve" && decision !== "reject") return c.json({ error: "decision must be approve or reject" }, 400);
  const note = String(body.note || "").slice(0, 500);
  const db = getDb(c.env);
  const prop = await db
    .prepare("SELECT version, status, config, proposed_by, base_version FROM ra_recon_rule_versions WHERE version = ?")
    .bind(version)
    .first<{ version: number; status: string; config: unknown; proposed_by: string; base_version: number | null }>();
  if (!prop) return c.json({ error: "Proposal not found" }, 404);
  if (prop.status !== "proposed") return c.json({ error: `Version ${version} is already ${prop.status}.` }, 409);
  if (prop.proposed_by === user.id) return c.json({ error: "Maker-checker: the proposer cannot approve or reject their own change." }, 403);
  clearReconConfigCache();
  const active = await activeReconConfig(db);
  const cfg = parseConfig(prop.config);
  if (decision === "reject") {
    await db
      .prepare(
        `WITH upd AS (
           UPDATE ra_recon_rule_versions SET status = 'rejected', decided_by = ?, decided_at = now()
           WHERE version = ? AND status = 'proposed' RETURNING version, config
         )
         INSERT INTO ra_recon_rule_audit (version, action, actor, role, old_config, new_config, changes, note)
         SELECT version, 'rejected', ?::text, ?::text, ?::jsonb, config, ?::jsonb, ?::text FROM upd`,
      )
      .bind(user.id, version, user.id, user.role, JSON.stringify(active.config), JSON.stringify(diffReconConfig(active.config, cfg)), note)
      .run();
    return c.json({ ok: true, version, status: "rejected" });
  }
  if (Number(prop.base_version) !== active.version) {
    return c.json({ error: `Stale proposal: it was based on version ${prop.base_version}, active is ${active.version}. Reject it and propose again.` }, 409);
  }
  const changes = diffReconConfig(active.config, cfg);
  // One UPDATE activates the proposal and supersedes the old active version atomically.
  const row = await db
    .prepare(
      `WITH upd AS (
         UPDATE ra_recon_rule_versions v
         SET status = CASE WHEN v.version = ?::int THEN 'active' ELSE 'superseded' END,
             decided_by = CASE WHEN v.version = ?::int THEN ?::text ELSE v.decided_by END,
             decided_at = CASE WHEN v.version = ?::int THEN now() ELSE v.decided_at END
         WHERE ((v.version = ?::int AND v.status = 'proposed') OR (v.version = ?::int AND v.status = 'active'))
           AND EXISTS (SELECT 1 FROM ra_recon_rule_versions a WHERE a.version = ?::int AND a.status = 'active')
           AND EXISTS (SELECT 1 FROM ra_recon_rule_versions p WHERE p.version = ?::int AND p.status = 'proposed')
         RETURNING v.version, v.status, v.config
       ), aud AS (
         INSERT INTO ra_recon_rule_audit (version, action, actor, role, old_config, new_config, changes, note)
         SELECT n.version, 'approved', ?::text, ?::text, o.config, n.config, ?::jsonb, ?::text
         FROM upd n LEFT JOIN upd o ON o.status = 'superseded'
         WHERE n.status = 'active'
         RETURNING id
       )
       SELECT (SELECT COUNT(*) FROM upd)::int AS n, (SELECT COUNT(*) FROM aud)::int AS audited`,
    )
    .bind(
      version, version, user.id, version, version, active.version, active.version, version,
      user.id, user.role, JSON.stringify(changes), note,
    )
    .first<{ n: number; audited: number }>();
  if (!row || Number(row.audited) !== 1) return c.json({ error: "Activation raced with another change. Reload and retry." }, 409);
  clearReconConfigCache();
  const { clearAgentSummaryCache } = await import("./recon");
  clearAgentSummaryCache();
  return c.json({ ok: true, version, status: "active", superseded: active.version, changes });
}
