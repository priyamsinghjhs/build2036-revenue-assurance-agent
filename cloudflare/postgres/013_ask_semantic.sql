-- Allow-listed Ask views for acquirer success, scheme approval, and FX markup.
-- Underlying feature tables stay hidden from raw questions except through these views.

CREATE OR REPLACE VIEW v_ask_acquirers AS
SELECT
  acquirer_id,
  COUNT(*)::int AS txn_count,
  AVG(CASE WHEN status = 'approved' THEN 1.0 ELSE 0.0 END)::double precision AS success_rate
FROM ra_feat_auth
WHERE acquirer_id IS NOT NULL
GROUP BY acquirer_id;

CREATE OR REPLACE VIEW v_ask_schemes AS
SELECT
  scheme,
  COUNT(*)::int AS txn_count,
  AVG(CASE WHEN status = 'approved' THEN 1.0 ELSE 0.0 END)::double precision AS approval_rate
FROM ra_feat_auth
WHERE scheme IS NOT NULL
GROUP BY scheme;

CREATE OR REPLACE VIEW v_ask_fx AS
SELECT
  from_ccy,
  to_ccy,
  COUNT(*)::int AS txn_count,
  AVG(applied_bps)::double precision AS applied_bps,
  AVG(agreed_bps)::double precision AS agreed_bps,
  AVG(markup_dev)::double precision AS markup_bps,
  SUM(amount)::double precision AS amount
FROM ra_feat_fx
GROUP BY from_ccy, to_ccy;

GRANT SELECT ON ra_feat_auth, ra_feat_fx, v_ask_acquirers, v_ask_schemes, v_ask_fx TO ra_readonly;
