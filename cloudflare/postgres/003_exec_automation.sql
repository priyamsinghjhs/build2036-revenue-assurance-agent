-- Executive brief cache, automation log, and action-queue decision columns.
-- Apply once: same DATABASE_URL as 001/002. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS ra_exec_brief (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  as_of TEXT NOT NULL,
  bullets JSONB NOT NULL,
  source TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ra_automation_log (
  log_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  detail JSONB
);

ALTER TABLE ra_action_queue ADD COLUMN IF NOT EXISTS decided_at TEXT;
ALTER TABLE ra_action_queue ADD COLUMN IF NOT EXISTS decision_note TEXT;

COMMIT;
