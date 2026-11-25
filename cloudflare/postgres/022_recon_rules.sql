-- Configurable reconciliation rules and tolerances
CREATE TABLE IF NOT EXISTS ra_recon_rules (
  id serial PRIMARY KEY,
  domain text NOT NULL,
  category text NOT NULL,
  tolerance_bps numeric DEFAULT 0,
  tolerance_amount numeric DEFAULT 0,
  auto_writeoff_threshold numeric DEFAULT 0,
  enabled boolean DEFAULT true,
  description text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (domain, category)
);

INSERT INTO ra_recon_rules (domain, category, tolerance_bps, tolerance_amount, description) VALUES
  ('scheme', 'scheme_fee_variance', 10, 5, 'Scheme fee variance tolerance'),
  ('authorization', 'auth_capture_mismatch', 0, 1, 'Auth vs capture amount tolerance'),
  ('payouts', 'under_payout', 0, 10, 'Under-payout threshold')
ON CONFLICT (domain, category) DO NOTHING;
