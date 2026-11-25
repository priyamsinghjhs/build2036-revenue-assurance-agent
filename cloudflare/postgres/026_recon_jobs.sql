-- DB-backed background recon jobs (Workers Free has no Queues). Additive, idempotent.
CREATE TABLE IF NOT EXISTS ra_recon_jobs (
  job_id          text PRIMARY KEY,
  idempotency_key text UNIQUE,
  scope           text NOT NULL,
  domain          text,
  mode            text NOT NULL DEFAULT 'default',
  status          text NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  run_id          text,
  total_steps     integer NOT NULL DEFAULT 0,
  done_steps      integer NOT NULL DEFAULT 0,
  failed_steps    integer NOT NULL DEFAULT 0,
  lease_until     timestamptz,
  chunks          integer NOT NULL DEFAULT 0,
  requested_by    text NOT NULL,
  rule_version    integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ra_recon_jobs_open ON ra_recon_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ra_recon_job_steps (
  job_id     text NOT NULL REFERENCES ra_recon_jobs(job_id),
  seq        integer NOT NULL,
  agent_id   text NOT NULL,
  status     text NOT NULL CHECK (status IN ('pending','running','done','failed')),
  attempts   integer NOT NULL DEFAULT 0,
  output_id  text,
  error      text,
  started_at timestamptz,
  ended_at   timestamptz,
  ms         integer,
  PRIMARY KEY (job_id, seq)
);
