-- Always-on Postgres indexes for merchant, date, and recon area.
-- Safe to re-run. Targets the hot paths used by dashboards and daily recon.

CREATE INDEX IF NOT EXISTS idx_ra_auth_merchant_ts ON ra_authorizations (merchant_id, ts);
CREATE INDEX IF NOT EXISTS idx_ra_auth_ts ON ra_authorizations (ts);
CREATE INDEX IF NOT EXISTS idx_ra_captures_merchant ON ra_captures (merchant_id);
CREATE INDEX IF NOT EXISTS idx_ra_captures_ts ON ra_captures (ts);
CREATE INDEX IF NOT EXISTS idx_ra_scheme_ts ON ra_scheme_settlements (ts);
CREATE INDEX IF NOT EXISTS idx_ra_bank_ts ON ra_bank_transactions (ts);

CREATE INDEX IF NOT EXISTS idx_ra_exception_merchant_ts ON ra_exception_rows (merchant_id, ts);
CREATE INDEX IF NOT EXISTS idx_ra_exception_area_ts ON ra_exception_rows (area, ts);
CREATE INDEX IF NOT EXISTS idx_ra_exception_area_merchant ON ra_exception_rows (area, merchant_id);

-- Incremental recon watermark: last day successfully reconciled per area.
-- Recon only re-runs a day when source rows for that day changed.
CREATE TABLE IF NOT EXISTS ra_recon_watermark (
  area TEXT NOT NULL,
  recon_date DATE NOT NULL,
  source_hash TEXT,
  exception_count INT NOT NULL DEFAULT 0,
  leakage NUMERIC(18,2) NOT NULL DEFAULT 0,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (area, recon_date)
);

CREATE INDEX IF NOT EXISTS idx_ra_watermark_date ON ra_recon_watermark (recon_date);
