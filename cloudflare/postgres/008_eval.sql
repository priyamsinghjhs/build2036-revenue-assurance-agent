-- V7c: grounding / faithfulness scores and hybrid RAG index
BEGIN;

CREATE TABLE IF NOT EXISTS ra_eval_scores (
  eval_id TEXT PRIMARY KEY,
  run_id TEXT,
  output_id TEXT,
  agent_id TEXT NOT NULL,
  faithfulness NUMERIC(6,4) NOT NULL,
  claims INT NOT NULL DEFAULT 0,
  supported INT NOT NULL DEFAULT 0,
  retries INT NOT NULL DEFAULT 0,
  verification TEXT NOT NULL, -- grounded | unverified
  unsupported JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ra_eval_scores_agent_idx ON ra_eval_scores (agent_id, created_at DESC);

ALTER TABLE ra_document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading,'') || ' ' || coalesce(body,''))) STORED;

CREATE INDEX IF NOT EXISTS ra_document_chunks_fts_idx ON ra_document_chunks USING GIN (fts);

CREATE OR REPLACE VIEW v_ra_eval_quality AS
SELECT
  agent_id,
  COUNT(*)::int AS n,
  ROUND(AVG(faithfulness)::numeric, 3) AS faithfulness,
  ROUND((1 - AVG(faithfulness))::numeric, 3) AS hallucination_rate,
  COALESCE(SUM(retries),0)::int AS retries,
  COUNT(*) FILTER (WHERE verification = 'unverified')::int AS unverified
FROM ra_eval_scores
GROUP BY agent_id;

GRANT SELECT ON ra_eval_scores, v_ra_eval_quality TO ra_readonly;

-- Unverified agent outputs also appear in the human review queue
CREATE OR REPLACE VIEW v_ra_review_queue AS
SELECT
  r.run_id,
  regexp_replace(r.scope, '^exception:', '') AS exception_id,
  split_part(regexp_replace(r.scope, '^exception:', ''), ':', 1) AS domain,
  r.started_at,
  r.completed_at,
  aud.output_json::jsonb AS auditor_json,
  inv.output_json::jsonb AS investigator_json,
  act.output_json::jsonb AS action_json,
  d.decision,
  d.decided_at,
  d.reviewer,
  CASE WHEN d.review_id IS NULL THEN 'pending' ELSE d.decision END AS review_status
FROM ra_agent_runs r
JOIN LATERAL (
  SELECT output_json, created_at FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'auditor'
  ORDER BY created_at DESC LIMIT 1
) aud ON true
LEFT JOIN LATERAL (
  SELECT output_json FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'investigator'
  ORDER BY created_at DESC LIMIT 1
) inv ON true
LEFT JOIN LATERAL (
  SELECT output_json FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'action'
  ORDER BY created_at DESC LIMIT 1
) act ON true
LEFT JOIN LATERAL (
  SELECT * FROM ra_review_decisions d0
  WHERE d0.run_id = r.run_id OR d0.exception_id = regexp_replace(r.scope, '^exception:', '')
  ORDER BY d0.decided_at DESC LIMIT 1
) d ON true
WHERE r.scope LIKE 'exception:%'
  AND (
    aud.output_json::text ILIKE '%needs_review%'
    OR COALESCE(aud.output_json::jsonb->>'signoff','') = 'needs_review'
    OR COALESCE(aud.output_json::jsonb->>'verification','') = 'unverified'
    OR EXISTS (
      SELECT 1 FROM ra_agent_outputs o
      WHERE o.run_id = r.run_id
        AND COALESCE(o.output_json::jsonb->>'verification','') = 'unverified'
    )
  );

COMMIT;
