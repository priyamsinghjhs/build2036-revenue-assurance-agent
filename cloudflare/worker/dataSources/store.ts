import type { AppDb } from "../pg";
import type { Env } from "../types";
import { getConnector, publicCatalog, MAPPING_TARGETS, type ConnectorDef } from "./catalog";
import { decryptJson, encryptJson, kekConfigured, KekMissingError } from "./crypto";
import { runProbe, type ProbeResult } from "./probes";

export type MappingRow = { target: string; source_field: string; dest_field: string };
export type ConnectionRow = {
  connection_id: string;
  connector_id: string;
  name: string;
  status: string;
  config_json: Record<string, string>;
  credentials_enc: string | null;
  mapping_json: MappingRow[];
  schedule_kind: string;
  schedule_enabled: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_message: string | null;
  kek_configured: boolean;
  created_at: string;
  updated_at: string;
};

function asObject(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (val != null && typeof val !== "object") out[k] = String(val);
  }
  return out;
}

function asMapping(v: unknown): MappingRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { target: String(r.target ?? ""), source_field: String(r.source_field ?? ""), dest_field: String(r.dest_field ?? "") };
    })
    .filter((r) => r.target && r.dest_field);
}

function parseRow(r: Record<string, unknown>): ConnectionRow {
  return {
    connection_id: String(r.connection_id),
    connector_id: String(r.connector_id),
    name: String(r.name),
    status: String(r.status),
    config_json: asObject(typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json),
    credentials_enc: r.credentials_enc ? String(r.credentials_enc) : null,
    mapping_json: asMapping(typeof r.mapping_json === "string" ? JSON.parse(r.mapping_json) : r.mapping_json),
    schedule_kind: String(r.schedule_kind ?? "manual"),
    schedule_enabled: Boolean(r.schedule_enabled),
    last_test_at: r.last_test_at ? String(r.last_test_at) : null,
    last_test_ok: r.last_test_ok == null ? null : Boolean(r.last_test_ok),
    last_test_message: r.last_test_message ? String(r.last_test_message) : null,
    last_sync_at: r.last_sync_at ? String(r.last_sync_at) : null,
    last_sync_ok: r.last_sync_ok == null ? null : Boolean(r.last_sync_ok),
    last_sync_message: r.last_sync_message ? String(r.last_sync_message) : null,
    kek_configured: Boolean(r.kek_configured),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function publicConnection(row: ConnectionRow, connector?: ConnectorDef) {
  const secretNames = new Set((connector ?? getConnector(row.connector_id))?.fields.filter((f) => f.secret).map((f) => f.name) ?? []);
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.config_json)) {
    if (!secretNames.has(k)) config[k] = v;
  }
  return {
    connection_id: row.connection_id,
    connector_id: row.connector_id,
    name: row.name,
    status: row.status,
    config,
    has_credentials: Boolean(row.credentials_enc),
    mapping: row.mapping_json,
    schedule_kind: row.schedule_kind,
    schedule_enabled: row.schedule_enabled,
    last_test_at: row.last_test_at,
    last_test_ok: row.last_test_ok,
    last_test_message: row.last_test_message,
    last_sync_at: row.last_sync_at,
    last_sync_ok: row.last_sync_ok,
    last_sync_message: row.last_sync_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function overview(db: AppDb, env: Env) {
  const { results } = await db
    .prepare("SELECT * FROM ra_data_source_connections ORDER BY updated_at DESC")
    .all<Record<string, unknown>>();
  const rows = (results ?? []).map(parseRow);
  return {
    kek_configured: kekConfigured(env.DATA_SOURCES_KEK),
    note: kekConfigured(env.DATA_SOURCES_KEK)
      ? "Credentials are encrypted with AES-GCM and are never returned to the browser."
      : "DATA_SOURCES_KEK is not set on this Worker. You can save non-secret configuration, but credentials cannot be stored or tested until an operator sets that secret.",
    catalog: publicCatalog(),
    mapping_targets: MAPPING_TARGETS,
    connections: rows.map((r) => publicConnection(r)),
  };
}

async function getRow(db: AppDb, id: string): Promise<ConnectionRow | null> {
  const r = await db.prepare("SELECT * FROM ra_data_source_connections WHERE connection_id = ?").bind(id).first<Record<string, unknown>>();
  return r ? parseRow(r) : null;
}

function splitFields(connector: ConnectorDef, input: Record<string, string>) {
  const config: Record<string, string> = {};
  const creds: Record<string, string> = {};
  for (const field of connector.fields) {
    const val = (input[field.name] ?? "").trim();
    if (!val) continue;
    if (field.secret) creds[field.name] = val;
    else config[field.name] = val;
  }
  return { config, creds };
}

export async function upsertConnection(
  db: AppDb,
  env: Env,
  body: Record<string, unknown>,
): Promise<{ ok: true; connection: ReturnType<typeof publicConnection> } | { ok: false; status: number; error: string }> {
  const connectorId = String(body.connector_id ?? "");
  const connector = getConnector(connectorId);
  if (!connector) return { ok: false, status: 400, error: "Unknown connector." };
  const name = String(body.name ?? connector.title).trim() || connector.title;
  const schedule_kind = String(body.schedule_kind ?? "manual");
  if (!["manual", "hourly", "daily", "weekly"].includes(schedule_kind)) return { ok: false, status: 400, error: "schedule_kind must be manual, hourly, daily or weekly." };
  const schedule_enabled = Boolean(body.schedule_enabled);
  const mapping = asMapping(body.mapping);
  const fields = asObject(body.fields ?? body.config);
  const { config, creds } = splitFields(connector, fields);
  const connectionId = String(body.connection_id ?? crypto.randomUUID());
  const existing = await getRow(db, connectionId);

  let credentials_enc = existing?.credentials_enc ?? null;
  if (Object.keys(creds).length) {
    if (!kekConfigured(env.DATA_SOURCES_KEK)) {
      return { ok: false, status: 503, error: new KekMissingError().message };
    }
    const prior = existing?.credentials_enc && kekConfigured(env.DATA_SOURCES_KEK)
      ? await decryptJson(env.DATA_SOURCES_KEK, existing.credentials_enc).catch(() => ({} as Record<string, string>))
      : {};
    credentials_enc = await encryptJson(env.DATA_SOURCES_KEK, { ...prior, ...creds });
  }

  const status = credentials_enc || Object.keys(config).length ? "configured" : "draft";
  const now = new Date().toISOString();
  if (existing) {
    await db
      .prepare(
        `UPDATE ra_data_source_connections SET
           name=?, status=?, config_json=?::jsonb, credentials_enc=?, mapping_json=?::jsonb,
           schedule_kind=?, schedule_enabled=?, kek_configured=?, updated_at=?
         WHERE connection_id=?`,
      )
      .bind(
        name, status, JSON.stringify({ ...existing.config_json, ...config }), credentials_enc,
        JSON.stringify(mapping.length ? mapping : existing.mapping_json),
        schedule_kind, schedule_enabled, kekConfigured(env.DATA_SOURCES_KEK), now, connectionId,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO ra_data_source_connections (
           connection_id, connector_id, name, status, config_json, credentials_enc, mapping_json,
           schedule_kind, schedule_enabled, kek_configured, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?, ?, ?, ?)`,
      )
      .bind(
        connectionId, connectorId, name, status, JSON.stringify(config), credentials_enc,
        JSON.stringify(mapping), schedule_kind, schedule_enabled, kekConfigured(env.DATA_SOURCES_KEK), now, now,
      )
      .run();
  }
  const row = await getRow(db, connectionId);
  if (!row) return { ok: false, status: 500, error: "Connection was not saved." };
  return { ok: true, connection: publicConnection(row, connector) };
}

export async function deleteConnection(db: AppDb, id: string) {
  const row = await getRow(db, id);
  if (!row) return false;
  await db.prepare("DELETE FROM ra_data_source_connections WHERE connection_id = ?").bind(id).run();
  return true;
}

export async function testConnection(db: AppDb, env: Env, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const row = await getRow(db, id);
  if (!row) return { status: 404, body: { error: "Connection not found." } };
  const connector = getConnector(row.connector_id);
  if (!connector) return { status: 400, body: { error: "Unknown connector." } };
  let creds: Record<string, string> = {};
  if (row.credentials_enc) {
    if (!kekConfigured(env.DATA_SOURCES_KEK)) {
      return { status: 503, body: { error: new KekMissingError().message, ok: false } };
    }
    try {
      creds = await decryptJson(env.DATA_SOURCES_KEK, row.credentials_enc);
    } catch (err) {
      const message = err instanceof KekMissingError ? err.message : "Stored credentials could not be decrypted with the current key.";
      return { status: 500, body: { error: message, ok: false } };
    }
  }
  const result: ProbeResult = await runProbe(connector, row.config_json, creds);
  const now = new Date().toISOString();
  const nextStatus = result.ok ? "tested" : row.credentials_enc || Object.keys(row.config_json).length ? "error" : "draft";
  await db
    .prepare(
      `UPDATE ra_data_source_connections SET last_test_at=?, last_test_ok=?, last_test_message=?, status=?, updated_at=? WHERE connection_id=?`,
    )
    .bind(now, result.ok, result.message, nextStatus, now, id)
    .run();
  await db
    .prepare(
      `INSERT INTO ra_data_source_runs (run_id, connection_id, kind, ok, message, detail_json, started_at, finished_at)
       VALUES (?, ?, 'test', ?, ?, ?::jsonb, ?, ?)`,
    )
    .bind(crypto.randomUUID(), id, result.ok, result.message, JSON.stringify({ http_status: result.http_status ?? null, probe: result.probe, latency_ms: result.latency_ms }), now, now)
    .run()
    .catch(() => undefined);
  return { status: result.ok ? 200 : 200, body: { ...result, connection: publicConnection({ ...row, last_test_at: now, last_test_ok: result.ok, last_test_message: result.message, status: nextStatus, updated_at: now }, connector) } };
}

export async function syncConnection(db: AppDb, env: Env, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const row = await getRow(db, id);
  if (!row) return { status: 404, body: { error: "Connection not found." } };
  const connector = getConnector(row.connector_id);
  if (!connector) return { status: 400, body: { error: "Unknown connector." } };
  const test = await testConnection(db, env, id);
  const probe = test.body as ProbeResult & { ok: boolean };
  const now = new Date().toISOString();
  let message: string;
  let ok = false;
  if (connector.sync_mode === "gateway") {
    message = "Scheduled sync is not started for gateway connectors. A Worker on the free plan cannot speak Oracle Net, Hive Thrift, or raw MySQL/Mongo TCP.";
  } else if (!probe.ok) {
    message = `Sync was not started because the live probe failed: ${probe.message}`;
  } else {
    ok = true;
    message = `Probe succeeded (${probe.probe}, ${probe.latency_ms} ms). A full extract into the October book is not enabled on the free plan — this run recorded the health check only and did not write book rows.`;
  }
  await db
    .prepare(`UPDATE ra_data_source_connections SET last_sync_at=?, last_sync_ok=?, last_sync_message=?, updated_at=? WHERE connection_id=?`)
    .bind(now, ok, message, now, id)
    .run();
  await db
    .prepare(
      `INSERT INTO ra_data_source_runs (run_id, connection_id, kind, ok, message, detail_json, started_at, finished_at)
       VALUES (?, ?, 'sync', ?, ?, ?::jsonb, ?, ?)`,
    )
    .bind(crypto.randomUUID(), id, ok, message, JSON.stringify({ probe: test.body }), now, now)
    .run()
    .catch(() => undefined);
  const fresh = await getRow(db, id);
  return { status: 200, body: { ok, message, probe: test.body, connection: fresh ? publicConnection(fresh, connector) : null } };
}

export async function syncDue(db: AppDb, env: Env, limit = 3) {
  const { results } = await db
    .prepare(
      `SELECT connection_id FROM ra_data_source_connections
       WHERE schedule_enabled = true AND schedule_kind <> 'manual'
       ORDER BY COALESCE(last_sync_at, to_timestamp(0)) ASC LIMIT ?`,
    )
    .bind(limit)
    .all<{ connection_id: string }>();
  const out = [];
  for (const r of results ?? []) {
    out.push(await syncConnection(db, env, r.connection_id));
  }
  return out;
}
