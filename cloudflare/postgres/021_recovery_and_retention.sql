-- Recovery tracking and data retention support
CREATE TABLE IF NOT EXISTS ra_recovery_events (
  id bigserial PRIMARY KEY,
  exception_id text NOT NULL,
  amount numeric NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT now(),
  recovered_by text,
  method text,
  note text
);
CREATE INDEX IF NOT EXISTS ra_recovery_events_ex ON ra_recovery_events (exception_id);

CREATE OR REPLACE VIEW v_ra_recovery_summary AS
SELECT
  exception_id,
  COUNT(*) AS events,
  COALESCE(SUM(amount),0) AS total_recovered,
  MAX(recovered_at) AS last_recovered
FROM ra_recovery_events
GROUP BY exception_id;

-- Retention policy stub (purge older than 2 years; run via cron)
-- DELETE FROM ra_login_attempts WHERE at < now() - interval '2 years';
-- DELETE FROM ra_audit_events WHERE at < now() - interval '7 years';
