-- Connection catalog for Settings > Data sources. Credentials are stored
-- only as AES-GCM ciphertext. Never grant these tables to ra_readonly.

CREATE TABLE IF NOT EXISTS ra_data_source_connections (
  connection_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_enc TEXT,
  mapping_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_kind TEXT NOT NULL DEFAULT 'manual',
  schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_message TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_ok BOOLEAN,
  last_sync_message TEXT,
  kek_configured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ra_data_source_connections_connector_idx
  ON ra_data_source_connections (connector_id);

CREATE TABLE IF NOT EXISTS ra_data_source_runs (
  run_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ra_data_source_connections(connection_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  message TEXT,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ra_data_source_runs_conn_idx
  ON ra_data_source_runs (connection_id, started_at DESC);
