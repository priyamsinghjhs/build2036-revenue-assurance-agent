-- Background recon job read paths (additive, idempotent).
CREATE INDEX IF NOT EXISTS idx_ra_agent_outputs_run ON ra_agent_outputs (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ra_agent_runs_scope_started ON ra_agent_runs (scope, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ra_eval_scores_run ON ra_eval_scores (run_id);
