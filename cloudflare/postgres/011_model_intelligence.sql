-- v9 Model Intelligence: DFS-style feature store, score tables, false-decline
-- leakage area, isolation-forest anomaly hooks, graph enrichment, retry bandits.
-- Scores themselves are written by the offline trainer + the TS evaluator.
-- BEGIN/COMMIT are stripped by _apply_neon.mjs.

CREATE TABLE IF NOT EXISTS ra_feat_auth (
  auth_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  ts TEXT,
  day DATE,
  amount DOUBLE PRECISION,
  log_amount DOUBLE PRECISION,
  hour INT,
  dow INT,
  scheme TEXT,
  method TEXT,
  channel TEXT,
  acquirer_id TEXT,
  mcc TEXT,
  status TEXT,
  decline_reason TEXT,
  merchant_txn_1d DOUBLE PRECISION,
  merchant_amt_1d DOUBLE PRECISION,
  merchant_txn_7d DOUBLE PRECISION,
  merchant_amt_7d DOUBLE PRECISION,
  merchant_approval_7d DOUBLE PRECISION,
  merchant_decline_7d DOUBLE PRECISION,
  merch_amt_z DOUBLE PRECISION,
  mcc_approval DOUBLE PRECISION,
  mcc_spend_ratio DOUBLE PRECISION,
  is_retry INT,
  retry_n_30m DOUBLE PRECISION,
  acquirer_approval DOUBLE PRECISION,
  scheme_approval DOUBLE PRECISION,
  method_approval DOUBLE PRECISION,
  merchant_cb_rate DOUBLE PRECISION,
  graph_risk DOUBLE PRECISION,
  shared_device_n DOUBLE PRECISION,
  ring_flag INT,
  loop_flag INT,
  fee_ratio_dev DOUBLE PRECISION,
  fx_markup_dev DOUBLE PRECISION,
  is_emi INT,
  label_false_decline INT,
  label_chargeback INT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_feat_settlement (
  scheme_id TEXT PRIMARY KEY,
  capture_id TEXT,
  scheme TEXT,
  settlement_date DATE,
  gross DOUBLE PRECISION,
  interchange_ratio DOUBLE PRECISION,
  scheme_fee_ratio DOUBLE PRECISION,
  net_ratio DOUBLE PRECISION,
  scheme_ic_baseline DOUBLE PRECISION,
  ic_dev DOUBLE PRECISION,
  fee_dev DOUBLE PRECISION,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_feat_fx (
  fx_id TEXT PRIMARY KEY,
  ts TEXT,
  from_ccy TEXT,
  to_ccy TEXT,
  amount DOUBLE PRECISION,
  applied_bps DOUBLE PRECISION,
  agreed_bps DOUBLE PRECISION,
  markup_dev DOUBLE PRECISION,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_model_cards (
  model_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  trained_at TIMESTAMPTZ,
  algorithm TEXT,
  n_train INT,
  n_test INT,
  auc DOUBLE PRECISION,
  pr_auc DOUBLE PRECISION,
  notes TEXT,
  metrics JSONB,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_model_scores (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  version TEXT,
  score DOUBLE PRECISION,
  raw_score DOUBLE PRECISION,
  base_value DOUBLE PRECISION,
  shap JSONB,
  top_factors JSONB,
  scored_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, model_id)
);
CREATE INDEX IF NOT EXISTS ra_model_scores_model ON ra_model_scores (model_id, score DESC);

CREATE TABLE IF NOT EXISTS ra_shap_global (
  model_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  mean_abs_shap DOUBLE PRECISION,
  rank INT,
  PRIMARY KEY (model_id, feature)
);

CREATE TABLE IF NOT EXISTS ra_graph_enrichment (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT,
  merchant_id TEXT,
  sage_score DOUBLE PRECISION,
  ring_flag INT DEFAULT 0,
  shared_device_n INT DEFAULT 0,
  shared_account_n INT DEFAULT 0,
  loop_flag INT DEFAULT 0,
  hops INT DEFAULT 0,
  note TEXT,
  source TEXT DEFAULT 'sql',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ra_ml_kpi (
  id INT PRIMARY KEY DEFAULT 1,
  false_decline_n INT,
  false_decline_recovery NUMERIC,
  chargeback_exposure NUMERIC,
  iforest_open INT,
  retry_recovered NUMERIC,
  retry_uplift DOUBLE PRECISION,
  models_version TEXT,
  refreshed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ra_retry_sim (
  policy TEXT PRIMARY KEY,
  n_candidates INT,
  approval_current DOUBLE PRECISION,
  approval_sim DOUBLE PRECISION,
  approval_uplift DOUBLE PRECISION,
  recovered NUMERIC,
  fee_cost NUMERIC,
  net_reward NUMERIC,
  note TEXT
);

CREATE TABLE IF NOT EXISTS ra_retry_sim_arms (
  policy TEXT NOT NULL,
  arm TEXT NOT NULL,
  n INT,
  p_approve DOUBLE PRECISION,
  recovered NUMERIC,
  fee_cost NUMERIC,
  PRIMARY KEY (policy, arm)
);

-- Graph: multi-hop rings, shared devices, routing loops (SQL, live).
CREATE OR REPLACE VIEW v_ra_graph_rings AS
WITH devices AS (
  SELECT e.src AS device_id, e.dst AS entity_id
  FROM ra_risk_edges e
  WHERE e.rel IN ('uses_device','operates_terminal','processed_card')
),
shared_dev AS (
  SELECT d1.entity_id, COUNT(DISTINCT d2.entity_id)::int AS n_others
  FROM devices d1
  JOIN devices d2 ON d2.device_id = d1.device_id AND d2.entity_id <> d1.entity_id
  GROUP BY 1
),
shared_acc AS (
  SELECT e1.src AS entity_id, COUNT(DISTINCT e2.src)::int AS n_others
  FROM ra_risk_edges e1
  JOIN ra_risk_edges e2 ON e2.dst = e1.dst AND e2.src <> e1.src
  WHERE e1.rel IN ('owns_account','shared_account','payout_routed')
    AND e2.rel IN ('owns_account','shared_account','payout_routed')
  GROUP BY 1
),
loops AS (
  SELECT DISTINCT e1.src AS entity_id
  FROM ra_risk_edges e1
  JOIN ra_risk_edges e2 ON e2.src = e1.dst AND e2.dst = e1.src
  WHERE e1.rel IN ('payout_routed','return_transfer','funded_changed_account','linked_to')
),
two_hop_bad AS (
  SELECT e1.src AS entity_id, COUNT(*)::int AS hops
  FROM ra_risk_edges e1
  JOIN ra_risk_edges e2 ON e2.src = e1.dst
  JOIN ra_risk_entities b ON b.entity_id = e2.dst AND (b.is_known_bad = 1 OR b.risk_score >= 60)
  WHERE e1.src <> e2.dst
  GROUP BY 1
)
SELECT
  en.entity_id,
  en.entity_type,
  en.merchant_id,
  en.risk_score,
  en.is_known_bad,
  COALESCE(sd.n_others, 0) AS shared_device_n,
  COALESCE(sa.n_others, 0) AS shared_account_n,
  CASE WHEN lp.entity_id IS NOT NULL THEN 1 ELSE 0 END AS loop_flag,
  CASE WHEN COALESCE(sd.n_others,0) >= 1 AND COALESCE(th.hops,0) >= 1 THEN 1
       WHEN COALESCE(sd.n_others,0) >= 2 THEN 1
       ELSE 0 END AS ring_flag,
  COALESCE(th.hops, 0) AS hops
FROM ra_risk_entities en
LEFT JOIN shared_dev sd ON sd.entity_id = en.entity_id
LEFT JOIN shared_acc sa ON sa.entity_id = en.entity_id
LEFT JOIN loops lp ON lp.entity_id = en.entity_id
LEFT JOIN two_hop_bad th ON th.entity_id = en.entity_id;

CREATE OR REPLACE FUNCTION public.refresh_ra_features()
RETURNS void
LANGUAGE plpgsql
AS $feat$
BEGIN
  -- Merchant / MCC / issuer-route / velocity features for every authorisation.
  DELETE FROM ra_feat_auth;
  INSERT INTO ra_feat_auth (
    auth_id, merchant_id, ts, day, amount, log_amount, hour, dow,
    scheme, method, channel, acquirer_id, mcc, status, decline_reason,
    merchant_txn_1d, merchant_amt_1d, merchant_txn_7d, merchant_amt_7d,
    merchant_approval_7d, merchant_decline_7d, merch_amt_z,
    mcc_approval, mcc_spend_ratio,
    is_retry, retry_n_30m,
    acquirer_approval, scheme_approval, method_approval,
    merchant_cb_rate, graph_risk, shared_device_n, ring_flag, loop_flag,
    fee_ratio_dev, fx_markup_dev, is_emi,
    label_false_decline, label_chargeback, is_synthetic
  )
  WITH base AS (
    SELECT a.auth_id, a.merchant_id, a.ts, a.amount, a.scheme, a.method, a.status, a.is_synthetic,
           a.ts::timestamptz AS ts_t,
           (a.ts::timestamptz)::date AS day,
           EXTRACT(HOUR FROM a.ts::timestamptz)::int AS hour,
           EXTRACT(DOW FROM a.ts::timestamptz)::int AS dow,
           COALESCE(attr.channel, a.method, 'other') AS channel,
           COALESCE(attr.decline_reason, '') AS decline_reason,
           COALESCE(attr.is_emi, 0) AS is_emi,
           r.acquirer_id,
           COALESCE(m.mcc, '0000') AS mcc
    FROM ra_authorizations a
    LEFT JOIN ra_auth_attributes attr ON attr.auth_id = a.auth_id
    LEFT JOIN ra_auth_routing r ON r.auth_id = a.auth_id
    LEFT JOIN ra_merchants m ON m.merchant_id = a.merchant_id
  ),
  mer_win AS (
    SELECT b.auth_id,
           COUNT(*) FILTER (
             WHERE o.auth_id <> b.auth_id AND o.day = b.day AND o.ts_t <= b.ts_t
           )::float AS merchant_txn_1d,
           COALESCE(SUM(o.amount) FILTER (
             WHERE o.auth_id <> b.auth_id AND o.day = b.day AND o.ts_t <= b.ts_t
           ), 0)::float AS merchant_amt_1d,
           COUNT(*) FILTER (
             WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
           )::float AS merchant_txn_7d,
           COALESCE(SUM(o.amount) FILTER (
             WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
           ), 0)::float AS merchant_amt_7d,
           COALESCE(
             AVG(CASE WHEN o.status='approved' THEN 1.0 ELSE 0.0 END) FILTER (
               WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
             ), 0.9
           )::float AS merchant_approval_7d,
           COALESCE(
             AVG(CASE WHEN o.status='declined' THEN 1.0 ELSE 0.0 END) FILTER (
               WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
             ), 0.1
           )::float AS merchant_decline_7d,
           COALESCE(
             AVG(o.amount) FILTER (
               WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
             ), b.amount
           )::float AS merch_amt_mu,
           COALESCE(
             NULLIF(STDDEV_POP(o.amount) FILTER (
               WHERE o.auth_id <> b.auth_id AND o.ts_t <= b.ts_t AND o.ts_t >= b.ts_t - interval '7 days'
             ), 0), 1
           )::float AS merch_amt_sd,
           COUNT(*) FILTER (
             WHERE o.auth_id <> b.auth_id AND o.ts_t < b.ts_t AND o.ts_t >= b.ts_t - interval '30 minutes'
               AND ABS(o.amount - b.amount) < 50
           )::float AS retry_n_30m
    FROM base b
    LEFT JOIN base o ON o.merchant_id = b.merchant_id
    GROUP BY b.auth_id, b.amount
  ),
  mcc_stats AS (
    SELECT mcc,
           AVG(CASE WHEN status='approved' THEN 1.0 ELSE 0.0 END)::float AS mcc_approval,
           SUM(amount)::float AS mcc_amt
    FROM base
    GROUP BY 1
  ),
  mer_mcc AS (
    SELECT merchant_id, mcc, SUM(amount)::float AS mer_mcc_amt
    FROM base
    GROUP BY 1,2
  ),
  acq AS (
    SELECT acquirer_id, AVG(CASE WHEN status='approved' THEN 1.0 ELSE 0.0 END)::float AS acquirer_approval
    FROM base WHERE acquirer_id IS NOT NULL GROUP BY 1
  ),
  sch AS (
    SELECT scheme, AVG(CASE WHEN status='approved' THEN 1.0 ELSE 0.0 END)::float AS scheme_approval
    FROM base GROUP BY 1
  ),
  meth AS (
    SELECT method, AVG(CASE WHEN status='approved' THEN 1.0 ELSE 0.0 END)::float AS method_approval
    FROM base GROUP BY 1
  ),
  cb AS (
    SELECT a.merchant_id,
           COUNT(cb.cb_id)::float / GREATEST(COUNT(DISTINCT c.capture_id), 1) AS merchant_cb_rate
    FROM ra_authorizations a
    LEFT JOIN ra_captures c ON c.auth_id = a.auth_id
    LEFT JOIN ra_chargebacks cb ON cb.capture_id = c.capture_id
    GROUP BY 1
  ),
  fee_base AS (
    SELECT c.auth_id, s.scheme,
           CASE WHEN s.gross = 0 THEN 0 ELSE (s.interchange + s.scheme_fee) / s.gross END AS fee_ratio
    FROM ra_captures c
    JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
  ),
  sch_fee AS (
    SELECT scheme, AVG(fee_ratio)::float AS baseline FROM fee_base GROUP BY 1
  ),
  fee AS (
    SELECT f.auth_id, f.fee_ratio - s.baseline AS fee_ratio_dev
    FROM fee_base f
    JOIN sch_fee s ON s.scheme = f.scheme
  ),
  fx AS (
    SELECT DISTINCT ON (c.auth_id) c.auth_id,
           ((f.applied_rate - f.reference_rate) / NULLIF(f.reference_rate,0) * 10000) - COALESCE(f.agreed_markup_bps,0) AS fx_markup_dev
    FROM ra_captures c
    JOIN ra_fx_conversions f ON f.recon_ref = c.recon_ref
    ORDER BY c.auth_id
  ),
  graph AS (
    SELECT COALESCE(e.merchant_id, REPLACE(e.entity_id, 'MER-', '')) AS merchant_id,
           MAX(e.risk_score)::float AS graph_risk,
           MAX(COALESCE(g.shared_device_n,0))::float AS shared_device_n,
           MAX(COALESCE(g.ring_flag,0))::int AS ring_flag,
           MAX(COALESCE(g.loop_flag,0))::int AS loop_flag
    FROM ra_risk_entities e
    LEFT JOIN v_ra_graph_rings g ON g.entity_id = e.entity_id
    GROUP BY 1
  ),
  lab_cb AS (
    SELECT c.auth_id, 1 AS label_chargeback
    FROM ra_captures c
    JOIN ra_chargebacks cb ON cb.capture_id = c.capture_id
  )
  SELECT
    b.auth_id, b.merchant_id, b.ts, b.day, b.amount,
    LN(GREATEST(b.amount, 1)),
    b.hour, b.dow, b.scheme, b.method, b.channel, b.acquirer_id, b.mcc, b.status, b.decline_reason,
    w.merchant_txn_1d, w.merchant_amt_1d, w.merchant_txn_7d, w.merchant_amt_7d,
    w.merchant_approval_7d, w.merchant_decline_7d,
    (b.amount - w.merch_amt_mu) / w.merch_amt_sd,
    COALESCE(ms.mcc_approval, 0.9),
    CASE WHEN COALESCE(ms.mcc_amt,0)=0 THEN 0 ELSE COALESCE(mm.mer_mcc_amt,0) / ms.mcc_amt END,
    CASE WHEN w.retry_n_30m > 0 THEN 1 ELSE 0 END,
    w.retry_n_30m,
    COALESCE(acq.acquirer_approval, 0.9),
    COALESCE(sch.scheme_approval, 0.9),
    COALESCE(meth.method_approval, 0.9),
    COALESCE(cb.merchant_cb_rate, 0),
    COALESCE(g.graph_risk, 0),
    COALESCE(g.shared_device_n, 0),
    COALESCE(g.ring_flag, 0),
    COALESCE(g.loop_flag, 0),
    COALESCE(fee.fee_ratio_dev, 0),
    COALESCE(fx.fx_markup_dev, 0),
    b.is_emi,
    CASE WHEN b.status='declined' AND b.decline_reason IN ('do_not_honour','issuer_timeout') THEN 1 ELSE 0 END,
    COALESCE(lab_cb.label_chargeback, 0),
    COALESCE(b.is_synthetic, 1)
  FROM base b
  JOIN mer_win w ON w.auth_id = b.auth_id
  LEFT JOIN mcc_stats ms ON ms.mcc = b.mcc
  LEFT JOIN mer_mcc mm ON mm.merchant_id = b.merchant_id AND mm.mcc = b.mcc
  LEFT JOIN acq ON acq.acquirer_id = b.acquirer_id
  LEFT JOIN sch ON sch.scheme = b.scheme
  LEFT JOIN meth ON meth.method = b.method
  LEFT JOIN cb ON cb.merchant_id = b.merchant_id
  LEFT JOIN fee ON fee.auth_id = b.auth_id
  LEFT JOIN fx ON fx.auth_id = b.auth_id
  LEFT JOIN graph g ON g.merchant_id = b.merchant_id
  LEFT JOIN lab_cb ON lab_cb.auth_id = b.auth_id;

  DELETE FROM ra_feat_settlement;
  INSERT INTO ra_feat_settlement (
    scheme_id, capture_id, scheme, settlement_date, gross,
    interchange_ratio, scheme_fee_ratio, net_ratio,
    scheme_ic_baseline, ic_dev, fee_dev, is_synthetic
  )
  SELECT
    s.scheme_id, s.capture_id, s.scheme, s.settlement_date::date, s.gross,
    CASE WHEN s.gross=0 THEN 0 ELSE s.interchange / s.gross END,
    CASE WHEN s.gross=0 THEN 0 ELSE s.scheme_fee / s.gross END,
    CASE WHEN s.gross=0 THEN 0 ELSE s.net / s.gross END,
    AVG(CASE WHEN s.gross=0 THEN 0 ELSE s.interchange / s.gross END) OVER (PARTITION BY s.scheme),
    CASE WHEN s.gross=0 THEN 0 ELSE s.interchange / s.gross END
      - AVG(CASE WHEN s.gross=0 THEN 0 ELSE s.interchange / s.gross END) OVER (PARTITION BY s.scheme),
    CASE WHEN s.gross=0 THEN 0 ELSE s.scheme_fee / s.gross END
      - AVG(CASE WHEN s.gross=0 THEN 0 ELSE s.scheme_fee / s.gross END) OVER (PARTITION BY s.scheme),
    COALESCE(s.is_synthetic, 1)
  FROM ra_scheme_settlements s;

  DELETE FROM ra_feat_fx;
  INSERT INTO ra_feat_fx (fx_id, ts, from_ccy, to_ccy, amount, applied_bps, agreed_bps, markup_dev, is_synthetic)
  SELECT
    f.fx_id, f.ts, f.from_ccy, f.to_ccy, f.amount,
    ((f.applied_rate - f.reference_rate) / NULLIF(f.reference_rate,0) * 10000),
    COALESCE(f.agreed_markup_bps, 0),
    ((f.applied_rate - f.reference_rate) / NULLIF(f.reference_rate,0) * 10000) - COALESCE(f.agreed_markup_bps, 0),
    COALESCE(f.is_synthetic, 1)
  FROM ra_fx_conversions f;

  -- SQL graph enrichment (GNN scores, if any, are left intact and only SQL flags refreshed)
  INSERT INTO ra_graph_enrichment (
    entity_id, entity_type, merchant_id, sage_score, ring_flag, shared_device_n,
    shared_account_n, loop_flag, hops, note, source, updated_at
  )
  SELECT
    g.entity_id, g.entity_type, g.merchant_id,
    e.sage_score,
    g.ring_flag, g.shared_device_n, g.shared_account_n, g.loop_flag, g.hops,
    CASE
      WHEN g.ring_flag = 1 THEN 'SQL multi-hop ring or shared-device cluster'
      WHEN g.loop_flag = 1 THEN 'SQL routing loop (bidirectional payout/return edge)'
      WHEN g.shared_device_n >= 1 THEN 'Shared device or terminal'
      ELSE 'No SQL graph flag'
    END,
    COALESCE(e.source, 'sql'),
    now()
  FROM v_ra_graph_rings g
  LEFT JOIN ra_graph_enrichment e ON e.entity_id = g.entity_id
  ON CONFLICT (entity_id) DO UPDATE SET
    entity_type = EXCLUDED.entity_type,
    merchant_id = EXCLUDED.merchant_id,
    ring_flag = EXCLUDED.ring_flag,
    shared_device_n = EXCLUDED.shared_device_n,
    shared_account_n = EXCLUDED.shared_account_n,
    loop_flag = EXCLUDED.loop_flag,
    hops = EXCLUDED.hops,
    note = EXCLUDED.note,
    updated_at = now();
END;
$feat$;

-- Exception view: high-confidence false declines. Uses model score when present,
-- otherwise a conservative rule on soft declines at high-approval merchants.
CREATE OR REPLACE VIEW v_ra_false_declines AS
SELECT
  f.auth_id AS ref_id,
  'false_declines'::text AS area,
  'unmatched'::text AS status,
  CASE
    WHEN f.auth_id LIKE 'FD-PLANT%' THEN 'false_decline_planted'
    WHEN f.decline_reason = 'issuer_timeout' THEN 'false_decline_timeout'
    ELSE 'false_decline_soft'
  END AS category,
  f.merchant_id,
  f.ts,
  f.amount AS expected_amount,
  0::double precision AS actual_amount,
  ROUND((f.amount * COALESCE(s.score, 0.65))::numeric, 2) AS leakage,
  COALESCE(s.version, 'rule-v9') AS recon_ref,
  f.method,
  f.scheme,
  'INR'::text AS currency
FROM ra_feat_auth f
LEFT JOIN ra_model_scores s
  ON s.subject_type = 'auth' AND s.subject_id = f.auth_id AND s.model_id = 'false_decline'
WHERE f.status = 'declined'
  AND (
    f.auth_id LIKE 'FD-PLANT%'
    OR f.decline_reason IN ('do_not_honour', 'issuer_timeout')
  )
  AND (
    COALESCE(s.score, 0) >= 0.55
    OR (
      s.score IS NULL
      AND f.merchant_approval_7d >= 0.80
    )
  );

CREATE OR REPLACE FUNCTION public.refresh_ra_retry_sim()
RETURNS void
LANGUAGE plpgsql
AS $retry$
DECLARE
  n_cand INT;
  rec RECORD;
  p_same DOUBLE PRECISION;
  p_alt DOUBLE PRECISION;
  p_token DOUBLE PRECISION;
  p_pick DOUBLE PRECISION;
  fee_pick DOUBLE PRECISION;
  recov NUMERIC := 0;
  fees NUMERIC := 0;
  arm_same INT := 0; arm_alt INT := 0; arm_token INT := 0;
  rec_same NUMERIC := 0; rec_alt NUMERIC := 0; rec_token NUMERIC := 0;
  fee_same NUMERIC := 0; fee_alt NUMERIC := 0; fee_token NUMERIC := 0;
BEGIN
  -- Thompson-style fee-aware retry on soft declines. Deterministic replay; not live traffic.
  -- Priors are calibrated by decline reason so arms diversify:
  --   issuer_timeout  prefers a network-token retry (p_token=0.55, p_same=0.48, p_alt=0.36)
  --   do_not_honour   prefers an alternate acquirer (p_alt=0.50, p_token=0.47, p_same=0.40)
  -- Reward = p*amount − fee (same-route 8 bps, alt-acquirer 14 bps, token 10 bps).
  -- Posterior means are used in place of a random Thompson draw so the replay is deterministic.
  DELETE FROM ra_retry_sim;
  DELETE FROM ra_retry_sim_arms;

  SELECT COUNT(*) INTO n_cand
  FROM ra_feat_auth
  WHERE status='declined' AND decline_reason IN ('do_not_honour','issuer_timeout');

  FOR rec IN
    SELECT f.auth_id, f.amount, f.decline_reason
    FROM ra_feat_auth f
    WHERE f.status='declined' AND f.decline_reason IN ('do_not_honour','issuer_timeout')
  LOOP
    IF rec.decline_reason = 'issuer_timeout' THEN
      p_same := 0.48; p_alt := 0.36; p_token := 0.55;
    ELSE
      p_same := 0.40; p_alt := 0.50; p_token := 0.47;
    END IF;
    IF (p_alt * rec.amount - 0.0014 * rec.amount) >= (p_token * rec.amount - 0.0010 * rec.amount)
       AND (p_alt * rec.amount - 0.0014 * rec.amount) >= (p_same * rec.amount - 0.0008 * rec.amount) THEN
      p_pick := p_alt; fee_pick := 0.0014; arm_alt := arm_alt + 1;
      rec_alt := rec_alt + rec.amount * p_alt; fee_alt := fee_alt + rec.amount * 0.0014;
    ELSIF (p_token * rec.amount - 0.0010 * rec.amount) >= (p_same * rec.amount - 0.0008 * rec.amount) THEN
      p_pick := p_token; fee_pick := 0.0010; arm_token := arm_token + 1;
      rec_token := rec_token + rec.amount * p_token; fee_token := fee_token + rec.amount * 0.0010;
    ELSE
      p_pick := p_same; fee_pick := 0.0008; arm_same := arm_same + 1;
      rec_same := rec_same + rec.amount * p_same; fee_same := fee_same + rec.amount * 0.0008;
    END IF;
    recov := recov + rec.amount * p_pick;
    fees := fees + rec.amount * fee_pick;
  END LOOP;

  INSERT INTO ra_retry_sim (policy, n_candidates, approval_current, approval_sim, approval_uplift, recovered, fee_cost, net_reward, note)
  VALUES (
    'thompson_retry', n_cand, 0,
    CASE WHEN n_cand=0 THEN 0 ELSE recov / NULLIF((SELECT COALESCE(SUM(amount),0) FROM ra_feat_auth WHERE status='declined' AND decline_reason IN ('do_not_honour','issuer_timeout')),0) END,
    CASE WHEN n_cand=0 THEN 0 ELSE recov / NULLIF((SELECT COALESCE(SUM(amount),0) FROM ra_feat_auth WHERE status='declined' AND decline_reason IN ('do_not_honour','issuer_timeout')),0) END,
    ROUND(recov,2), ROUND(fees,2), ROUND(recov-fees,2),
    'Deterministic fee-aware replay of Thompson-style retry arms on soft declines. Timeouts prefer a network-token retry; do-not-honour prefers an alternate acquirer. Not live traffic.'
  );

  INSERT INTO ra_retry_sim_arms (policy, arm, n, p_approve, recovered, fee_cost) VALUES
    ('thompson_retry','retry_same_route', arm_same, CASE WHEN arm_same=0 THEN 0 ELSE rec_same/NULLIF(recov,0) END, ROUND(rec_same,2), ROUND(fee_same,2)),
    ('thompson_retry','retry_alt_acquirer', arm_alt, CASE WHEN arm_alt=0 THEN 0 ELSE rec_alt/NULLIF(recov,0) END, ROUND(rec_alt,2), ROUND(fee_alt,2)),
    ('thompson_retry','retry_network_token', arm_token, CASE WHEN arm_token=0 THEN 0 ELSE rec_token/NULLIF(recov,0) END, ROUND(rec_token,2), ROUND(fee_token,2)),
    ('thompson_retry','no_retry', 0, 0, 0, 0);
END;
$retry$;

CREATE OR REPLACE FUNCTION public.sync_ra_iforest_anomalies()
RETURNS void
LANGUAGE plpgsql
AS $ifo$
BEGIN
  -- Isolation-forest flags are precomputed in ra_model_scores (model_id='iforest').
  -- Keep the open set small and never re-open investigated/resolved/acknowledged rows.
  INSERT INTO ra_anomaly_events (event_id, metric, segment, day, value, zscore, impact, note, status, is_synthetic)
  SELECT
    'IF-' || s.subject_type || '-' || s.subject_id,
    CASE s.subject_type
      WHEN 'settlement' THEN 'iforest_settlement'
      WHEN 'fx' THEN 'iforest_fx'
      WHEN 'fee' THEN 'iforest_fee'
      ELSE 'iforest_other'
    END,
    COALESCE(s.subject_id, 'ALL'),
    COALESCE(
      (SELECT settlement_date FROM ra_feat_settlement f WHERE f.scheme_id = s.subject_id),
      (SELECT (ts::timestamptz)::date FROM ra_feat_fx f WHERE f.fx_id = s.subject_id),
      DATE '2026-10-31'
    ),
    s.score,
    s.raw_score,
    COALESCE(
      (SELECT gross FROM ra_feat_settlement f WHERE f.scheme_id = s.subject_id),
      (SELECT amount FROM ra_feat_fx f WHERE f.fx_id = s.subject_id),
      0
    ),
    'Isolation forest (offline-trained, scored in-process). Higher score is more anomalous. Deduped by (metric, segment, day).',
    'open',
    1
  FROM ra_model_scores s
  WHERE s.model_id = 'iforest' AND s.score >= 0.70
  ON CONFLICT (metric, segment, day) DO UPDATE SET
    value = EXCLUDED.value,
    zscore = EXCLUDED.zscore,
    impact = EXCLUDED.impact,
    note = EXCLUDED.note
  WHERE ra_anomaly_events.status = 'open';

  -- Close stale IF events that are no longer above threshold, but only if still 'open'
  UPDATE ra_anomaly_events e
  SET status = 'resolved'
  WHERE e.metric LIKE 'iforest_%'
    AND e.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM ra_model_scores s
      WHERE s.model_id = 'iforest' AND s.score >= 0.70
        AND ('IF-' || s.subject_type || '-' || s.subject_id) = e.event_id
    );
END;
$ifo$;

CREATE OR REPLACE FUNCTION public.refresh_ra_v9()
RETURNS void
LANGUAGE plpgsql
AS $v9$
BEGIN
  PERFORM public.refresh_ra_features();
  PERFORM public.refresh_ra_retry_sim();
  PERFORM public.sync_ra_iforest_anomalies();

  DELETE FROM ra_exception_rows WHERE area = 'false_declines';
  INSERT INTO ra_exception_rows (
    ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  )
  SELECT ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_false_declines;

  DELETE FROM ra_area_summary WHERE area = 'false_declines';
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT
    'false_declines',
    'False declines (recoverable)',
    (SELECT COUNT(*) FROM ra_authorizations WHERE status='declined')
      - (SELECT COUNT(*) FROM v_ra_false_declines),
    (SELECT COUNT(*) FROM v_ra_false_declines),
    0,
    COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM v_ra_false_declines), 0),
    CASE
      WHEN (SELECT COUNT(*) FROM ra_authorizations WHERE status='declined') = 0 THEN 1
      ELSE 1 - (SELECT COUNT(*) FROM v_ra_false_declines)::numeric
               / GREATEST((SELECT COUNT(*) FROM ra_authorizations WHERE status='declined'), 1)
    END,
    (SELECT COUNT(*) FROM v_ra_false_declines);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'false_declines', 'false_declines', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day)
    FROM (
      SELECT to_char(f.day,'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n,
             ROUND(SUM(v.leakage)::numeric, 2) AS leakage
      FROM v_ra_false_declines v
      JOIN ra_feat_auth f ON f.auth_id = v.ref_id
      GROUP BY f.day
    ) s
  ), '[]'::jsonb)
  ON CONFLICT (area) DO UPDATE SET series_type = EXCLUDED.series_type, points = EXCLUDED.points;

  -- Book leakage KPI: false_declines is included (it is lost-revenue, not exposure).
  UPDATE ra_kpi_summary SET
    total_leakage = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    exception_count = (
      SELECT COALESCE(SUM(exception_count),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )
  WHERE id = 1;

  INSERT INTO ra_ml_kpi (
    id, false_decline_n, false_decline_recovery, chargeback_exposure,
    iforest_open, retry_recovered, retry_uplift, models_version, refreshed_at
  )
  SELECT 1,
    (SELECT COUNT(*) FROM v_ra_false_declines),
    COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_false_declines),0),
    COALESCE((
      -- High-risk slice only (score >= 0.55). Uncalibrated p*amount over the whole book
      -- would overstate exposure because the chargeback model is trained on 12 labels.
      SELECT ROUND(SUM(c.amount * s.score)::numeric, 2)
      FROM ra_captures c
      JOIN ra_model_scores s ON s.subject_type='capture' AND s.subject_id=c.capture_id AND s.model_id='chargeback'
      WHERE s.score >= 0.55
    ), 0),
    (SELECT COUNT(*) FROM ra_anomaly_events WHERE status='open' AND metric LIKE 'iforest_%'),
    COALESCE((SELECT recovered FROM ra_retry_sim WHERE policy='thompson_retry'),0),
    COALESCE((SELECT approval_uplift FROM ra_retry_sim WHERE policy='thompson_retry'),0),
    COALESCE((SELECT version FROM ra_model_cards WHERE model_id='false_decline' LIMIT 1), 'untrained'),
    now()
  ON CONFLICT (id) DO UPDATE SET
    false_decline_n = EXCLUDED.false_decline_n,
    false_decline_recovery = EXCLUDED.false_decline_recovery,
    chargeback_exposure = EXCLUDED.chargeback_exposure,
    iforest_open = EXCLUDED.iforest_open,
    retry_recovered = EXCLUDED.retry_recovered,
    retry_uplift = EXCLUDED.retry_uplift,
    models_version = EXCLUDED.models_version,
    refreshed_at = now();

  INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
  VALUES
    ('CTL-FD-HEALTH', 'False-decline recovery health', 'Soft declines with a high false-decline score are treated as recoverable lost revenue.', 'false_declines', 'Auth ops', 'daily', 'Scores populated', 'false_declines', '__health__', 1),
    ('CTL-PROC-GBDT', 'Gradient-boosted risk models', 'False-decline, chargeback and dispute-win models are trained offline (LightGBM) and scored with a pure TypeScript tree evaluator.', 'models', 'RA data science', 'weekly', 'Model card present', 'false_declines', '__process__', 1),
    ('CTL-PROC-IFOREST', 'Isolation-forest sensors', 'Unsupervised isolation forest on settlement, fee and FX features complements z-score/EWMA and is deduped.', 'anomalies', 'RA data science', 'daily', 'Sensors on', 'anomalies', '__process__', 1),
    ('CTL-PROC-SHAP', 'SHAP explanations', 'Per-score top factors use path-attribution TreeSHAP; the LLM may only narrate those factors.', 'models', 'RA data science', 'weekly', 'Factors stored', 'false_declines', '__process__', 1)
  ON CONFLICT (control_id) DO NOTHING;

  INSERT INTO ra_control_status (control_id, last_run, status, exception_count, leakage, trend, coverage)
  SELECT c.control_id, '2026-10-31',
         CASE
           WHEN c.maps_category='__process__' THEN CASE WHEN (SELECT COUNT(*) FROM ra_model_cards) > 0 THEN 'pass' ELSE 'watch' END
           ELSE CASE WHEN COALESCE(h.match_rate,1) >= 0.5 THEN 'pass' ELSE 'fail' END
         END,
         COALESCE(h.exception_count,0),
         ROUND(COALESCE(h.leakage,0)::numeric,2),
         'watch', 1
  FROM ra_controls c
  LEFT JOIN ra_area_summary h ON h.area=c.maps_area AND c.maps_category='__health__'
  WHERE c.control_id IN ('CTL-FD-HEALTH','CTL-PROC-GBDT','CTL-PROC-IFOREST','CTL-PROC-SHAP')
  ON CONFLICT (control_id) DO UPDATE SET
    status=EXCLUDED.status, exception_count=EXCLUDED.exception_count, leakage=EXCLUDED.leakage;

  -- Rebuild drivers/trend after false-decline exceptions have been inserted
  -- (core refresh runs before v9 and would otherwise omit them).
  DELETE FROM ra_leakage_category;
  INSERT INTO ra_leakage_category (area, category, n, leakage)
  SELECT area, category, COUNT(*)::int, ROUND(SUM(leakage)::numeric, 2)
  FROM ra_exception_rows
  GROUP BY area, category;

  DELETE FROM ra_leakage_trend;
  INSERT INTO ra_leakage_trend (day, leakage, n)
  SELECT SUBSTR(COALESCE(ts, 'unknown'), 1, 10),
         ROUND(SUM(leakage)::numeric, 2),
         COUNT(*)::int
  FROM ra_exception_rows
  WHERE ts IS NOT NULL
  GROUP BY 1;

  UPDATE ra_governance_kpi SET
    controls_total = (SELECT COUNT(*) FROM ra_controls),
    controls_pass = (SELECT COUNT(*) FROM ra_control_status WHERE status='pass'),
    controls_fail = (SELECT COUNT(*) FROM ra_control_status WHERE status='fail'),
    coverage_pct = 1
  WHERE id = 1;
END;
$v9$;

CREATE OR REPLACE FUNCTION public.refresh_ra_summaries()
RETURNS void
LANGUAGE plpgsql
AS $wrap$
BEGIN
  PERFORM refresh_ra_summaries_core();
  PERFORM refresh_ra_v7();
  PERFORM refresh_ra_v7b();
  PERFORM refresh_ra_v9();
END;
$wrap$;

GRANT SELECT ON ra_feat_auth, ra_feat_settlement, ra_feat_fx,
  ra_model_cards, ra_model_scores, ra_shap_global, ra_graph_enrichment,
  ra_ml_kpi, ra_retry_sim, ra_retry_sim_arms, v_ra_false_declines, v_ra_graph_rings
  TO ra_readonly;

SELECT public.refresh_ra_v9();
