-- Versioned, maker-checker recon rule configuration (additive, idempotent).
-- One row per version. Exactly one version is 'active'; proposals wait for a
-- different approver. Version 1 holds the defaults, which reproduce the
-- results the hard-coded rules gave before this migration (all tolerances 0).
CREATE TABLE IF NOT EXISTS ra_recon_rule_versions (
  version      integer PRIMARY KEY,
  status       text NOT NULL CHECK (status IN ('proposed','active','superseded','rejected')),
  config       jsonb NOT NULL,
  note         text,
  proposed_by  text NOT NULL,
  proposed_at  timestamptz NOT NULL DEFAULT now(),
  decided_by   text,
  decided_at   timestamptz,
  base_version integer
);
-- Activation supersedes the previous active version in the same UPDATE, so
-- there is never a moment with two (or zero) active versions.
CREATE INDEX IF NOT EXISTS ra_recon_rule_versions_status ON ra_recon_rule_versions (status, version DESC);

CREATE TABLE IF NOT EXISTS ra_recon_rule_audit (
  id         bigserial PRIMARY KEY,
  version    integer NOT NULL,
  action     text NOT NULL,            -- proposed | approved | rejected | seeded
  actor      text NOT NULL,
  role       text,
  at         timestamptz NOT NULL DEFAULT now(),
  old_config jsonb,
  new_config jsonb,
  changes    jsonb,
  note       text
);
CREATE INDEX IF NOT EXISTS ra_recon_rule_audit_version ON ra_recon_rule_audit (version, at DESC);

INSERT INTO ra_recon_rule_versions (version, status, config, note, proposed_by, decided_by, decided_at)
VALUES (1, 'active', '{
  "global": {"match_good": 0.98, "match_watch": 0.9},
  "areas": {
    "scheme":        {"amount_tolerance": 0, "fx_tolerance_bps": 0, "fee_variance_bps": 0, "date_window_days": 0, "matching_keys": ["recon_ref", "scheme", "currency"]},
    "apm":           {"amount_tolerance": 0, "fx_tolerance_bps": 0, "fee_variance_bps": 0, "date_window_days": 0, "matching_keys": ["ref_id", "method", "merchant_id"]},
    "authorization": {"amount_tolerance": 0, "fx_tolerance_bps": 0, "fee_variance_bps": 0, "date_window_days": 0, "matching_keys": ["ref_id", "merchant_id"]},
    "gl":            {"amount_tolerance": 0, "fx_tolerance_bps": 0, "fee_variance_bps": 0, "date_window_days": 0, "matching_keys": ["recon_ref", "ref_id"]},
    "invoicing":     {"amount_tolerance": 0, "fx_tolerance_bps": 0, "fee_variance_bps": 0, "date_window_days": 0, "matching_keys": ["merchant_id", "ref_id"]}
  }
}'::jsonb, 'Defaults: reproduce pre-config results (all tolerances 0).', 'system', 'system', now())
ON CONFLICT (version) DO NOTHING;

INSERT INTO ra_recon_rule_audit (version, action, actor, role, new_config, note)
SELECT 1, 'seeded', 'system', 'system', config, note FROM ra_recon_rule_versions v
WHERE v.version = 1 AND NOT EXISTS (SELECT 1 FROM ra_recon_rule_audit a WHERE a.version = 1 AND a.action = 'seeded');
