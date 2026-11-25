-- Login lockout counters and a write audit trail with the authenticated user id.

CREATE TABLE IF NOT EXISTS ra_login_attempts (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  ip text NOT NULL,
  ok boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ra_login_attempts_user_ip_at ON ra_login_attempts (username, ip, at DESC);
CREATE INDEX IF NOT EXISTS ra_login_attempts_ip_at ON ra_login_attempts (ip, at DESC);

CREATE TABLE IF NOT EXISTS ra_audit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  role text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  action text,
  entity_id text,
  detail jsonb
);
CREATE INDEX IF NOT EXISTS ra_audit_events_at ON ra_audit_events (at DESC);
CREATE INDEX IF NOT EXISTS ra_audit_events_user ON ra_audit_events (user_id, at DESC);

ALTER TABLE ra_action_queue ADD COLUMN IF NOT EXISTS decided_by text;

CREATE TABLE IF NOT EXISTS ra_session_revoke (
  user_id text PRIMARY KEY,
  revoked_before timestamptz NOT NULL
);
