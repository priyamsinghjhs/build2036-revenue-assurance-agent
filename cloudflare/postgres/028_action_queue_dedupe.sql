-- Duplicate pending proposals in ra_action_queue: every agent run inserted a fresh 'proposed' row
-- (new UUID) for the same exception and action, so the Action queue showed the same proposal N times.
-- Additive and idempotent: keep the most recent pending row per (exception_id, action) and mark the
-- others 'superseded' (no deletes), then enforce one pending row per key with a partial unique index.
WITH ranked AS (
  SELECT action_id,
         first_value(action_id) OVER w AS keep_id,
         row_number() OVER w AS rn
  FROM ra_action_queue
  WHERE status = 'proposed' AND exception_id IS NOT NULL
  WINDOW w AS (PARTITION BY exception_id, action ORDER BY created_at DESC, action_id DESC)
)
UPDATE ra_action_queue q
SET status = 'superseded',
    decided_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    decision_note = 'Superseded duplicate of ' || r.keep_id || ' (migration 028)'
FROM ranked r
WHERE q.action_id = r.action_id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ra_action_queue_pending
  ON ra_action_queue (exception_id, action)
  WHERE status = 'proposed' AND exception_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ra_action_queue_run ON ra_action_queue (run_id);
CREATE INDEX IF NOT EXISTS idx_ra_action_queue_created ON ra_action_queue (created_at DESC);
