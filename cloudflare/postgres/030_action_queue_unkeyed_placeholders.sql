-- Run-all action fallbacks with no exception ("Deterministic proposal for this exception", ₹0) were queued
-- on every run. The code no longer queues them; mark existing pending ones superseded (no deletes),
-- keeping the newest per (rationale, action). Idempotent.
WITH ranked AS (
  SELECT action_id, first_value(action_id) OVER w AS keep_id, row_number() OVER w AS rn
  FROM ra_action_queue
  WHERE status = 'proposed' AND exception_id IS NULL
  WINDOW w AS (PARTITION BY action, rationale ORDER BY created_at DESC, action_id DESC)
)
UPDATE ra_action_queue q
SET status = 'superseded',
    decided_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    decision_note = 'Superseded duplicate of ' || r.keep_id || ' (migration 030)'
FROM ranked r
WHERE q.action_id = r.action_id AND r.rn > 1;
