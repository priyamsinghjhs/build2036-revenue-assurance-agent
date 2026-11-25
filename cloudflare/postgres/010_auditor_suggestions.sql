-- 010: persist accept/dismiss of auditor suggestions (in-app only; nothing is sent externally).

BEGIN;

CREATE TABLE IF NOT EXISTS ra_audit_suggestion_decisions (
  decision_id TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  action_id TEXT,
  draft_id TEXT,
  case_id TEXT,
  reviewer TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (exception_id, suggestion_id)
);

CREATE INDEX IF NOT EXISTS ra_audit_suggestion_decisions_ex
  ON ra_audit_suggestion_decisions (exception_id);

COMMIT;
