-- V15: restore the read-only grant on v_ask_exceptions and record step latency.
--
-- 017 dropped and recreated v_ask_exceptions to recast money columns, which
-- silently removed the SELECT grant 006 gave ra_readonly. Ask templates that read
-- v_ask_exceptions then failed with "blocked by the read-only role".

GRANT SELECT ON v_ask_exceptions TO ra_readonly;

-- Additive: per-output latency so the quality table can show speed next to faithfulness.
ALTER TABLE ra_eval_scores ADD COLUMN IF NOT EXISTS latency_ms integer;

CREATE OR REPLACE VIEW v_ra_eval_quality AS
SELECT
  agent_id,
  COUNT(*)::int AS n,
  ROUND(AVG(faithfulness)::numeric, 3) AS faithfulness,
  ROUND((1 - AVG(faithfulness))::numeric, 3) AS hallucination_rate,
  COALESCE(SUM(retries),0)::int AS retries,
  COUNT(*) FILTER (WHERE verification = 'unverified')::int AS unverified,
  (percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL))::int AS p50_latency_ms
FROM ra_eval_scores
GROUP BY agent_id;

GRANT SELECT ON v_ra_eval_quality TO ra_readonly;
