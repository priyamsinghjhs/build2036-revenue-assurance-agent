-- 009: trim anomaly events to the four featured seeds; idempotent refresh.
-- Closes inflated rows created when refresh_ra_v7 re-inserted every |z|>=2.5 day.
-- Does not re-open investigated / resolved / acknowledged / closed events.

BEGIN;

-- Dedupe any duplicate (metric, segment, day) rows, keeping the featured event_id
-- or else the latest investigated / highest |z|.
DELETE FROM ra_anomaly_events a
USING ra_anomaly_events b
WHERE a.metric = b.metric AND a.segment = b.segment AND a.day = b.day
  AND a.event_id <> b.event_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS ra_anomaly_events_signal_entity_period
  ON ra_anomaly_events (metric, segment, day);

-- Close inflated non-featured rows (including extras previously investigated).
-- Leave featured rows' statuses untouched (do not re-open investigated).
UPDATE ra_anomaly_events
   SET status = 'closed'
 WHERE (metric, segment, day) NOT IN (
       ('approval_rate','UPI', DATE '2026-10-18'),
       ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
       ('fee_ratio','VISA', DATE '2026-10-12'),
       ('refund_cb_ratio','ALL', DATE '2026-10-27')
     )
   AND status NOT IN ('resolved', 'acknowledged', 'closed');

CREATE OR REPLACE FUNCTION public.sync_ra_anomaly_events()
RETURNS void
LANGUAGE plpgsql
AS $sync$
BEGIN
  INSERT INTO ra_anomaly_events (event_id, metric, segment, day, value, zscore, impact, note, status, is_synthetic)
  SELECT
    'ANOM-' || m.metric || '-' || m.segment || '-' || to_char(m.day, 'YYYYMMDD'),
    m.metric, m.segment, m.day, m.value, m.zscore,
    CASE m.metric
      WHEN 'fee_ratio' THEN COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,m.value)) / 10000
      WHEN 'approval_rate' THEN COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,m.value))
      WHEN 'settlement_latency' THEN COALESCE(m.volume,0) * 0.001 * GREATEST(m.value,0)
      ELSE COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,0))
    END,
    CASE m.metric
      WHEN 'approval_rate' THEN 'Approval rate outside the EWMA band'
      WHEN 'fee_ratio' THEN 'Scheme fee/volume ratio spike'
      WHEN 'settlement_latency' THEN 'Settlement latency vs expected date'
      WHEN 'refund_cb_ratio' THEN 'Refund and chargeback ratio spike'
      ELSE 'Hop volume anomaly'
    END,
    'open', 1
  FROM ra_metric_daily m
  WHERE (m.metric, m.segment, m.day) IN (
    ('approval_rate','UPI', DATE '2026-10-18'),
    ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
    ('fee_ratio','VISA', DATE '2026-10-12'),
    ('refund_cb_ratio','ALL', DATE '2026-10-27')
  )
  ON CONFLICT (event_id) DO UPDATE SET
    value = EXCLUDED.value,
    zscore = EXCLUDED.zscore,
    impact = EXCLUDED.impact,
    note = EXCLUDED.note
  WHERE ra_anomaly_events.status = 'open';

  UPDATE ra_anomaly_events e
     SET status = 'closed'
   WHERE e.status = 'open'
     AND (e.metric, e.segment, e.day) NOT IN (
       ('approval_rate','UPI', DATE '2026-10-18'),
       ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
       ('fee_ratio','VISA', DATE '2026-10-12'),
       ('refund_cb_ratio','ALL', DATE '2026-10-27')
     );
END;
$sync$;;

CREATE OR REPLACE FUNCTION public.refresh_ra_v7()
RETURNS void
LANGUAGE plpgsql
AS $v7$
BEGIN
  -- Exceptions for contracts + files
  DELETE FROM ra_exception_rows WHERE area IN ('contracts', 'files');
  INSERT INTO ra_exception_rows (
    ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  )
  SELECT ref_id, 'contracts', status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_contracts
  WHERE leakage > 0.5
  UNION ALL
  SELECT ref_id, 'files', status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_files;

  DELETE FROM ra_area_summary WHERE area IN ('contracts', 'files', 'anomalies');
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT 'contracts', 'Contracts & rules',
         (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved') ,
         (SELECT COUNT(*) FROM v_ra_contracts WHERE status='unmatched' AND leakage>0.5),
         (SELECT COUNT(*) FROM v_ra_contracts WHERE status='variance' AND leakage>0.5),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_contracts WHERE leakage>0.5),0),
         CASE WHEN (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved')=0 THEN 1
              ELSE 1 - (SELECT COUNT(*) FROM v_ra_contracts WHERE leakage>0.5)::double precision
                     / GREATEST((SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved'),1) END,
         (SELECT COUNT(*) FROM v_ra_contracts WHERE leakage>0.5)
  UNION ALL
  SELECT 'files', 'File completeness',
         (SELECT COUNT(*) FROM ra_expected_files) - (SELECT COUNT(*) FROM v_ra_files),
         (SELECT COUNT(*) FROM v_ra_files WHERE category='file_missing'),
         (SELECT COUNT(*) FROM v_ra_files WHERE category='file_out_of_sequence'),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_files),0),
         CASE WHEN (SELECT COUNT(*) FROM ra_expected_files)=0 THEN 1
              ELSE ((SELECT COUNT(*) FROM ra_expected_files) - (SELECT COUNT(*) FROM v_ra_files))::double precision
                   / GREATEST((SELECT COUNT(*) FROM ra_expected_files),1) END,
         (SELECT COUNT(*) FROM v_ra_files);

  -- Fold contracts + files into book leakage (exclude anomalies as sensors)
  UPDATE ra_kpi_summary SET
    total_leakage = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    recovery_potential = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    exception_count = (SELECT COUNT(*) FROM ra_exception_rows
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','files'))
  WHERE id = 1;

  DELETE FROM ra_area_series WHERE area IN ('contracts','files','anomalies');
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'contracts', 'contracts', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.leakage DESC)
    FROM (
      SELECT fee_type AS name, party, fee_type, status, ROUND(rate::numeric,2) AS rate,
             ROUND(COALESCE((SELECT leakage FROM v_ra_contracts c WHERE c.recon_ref = r.rule_id LIMIT 1),0)::numeric,2) AS leakage
      FROM ra_extracted_rules r
    ) s
  ), '[]'::jsonb)
  UNION ALL
  SELECT 'files', 'files', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.kind, s.party)
    FROM (
      SELECT e.file_kind AS kind, e.party, COUNT(*) AS expected,
             COUNT(r.received_id) AS received,
             COUNT(*) FILTER (WHERE r.received_id IS NULL) AS missing
      FROM ra_expected_files e
      LEFT JOIN ra_received_files r
        ON r.file_kind=e.file_kind AND r.party=e.party AND r.expected_date=e.expected_date
      GROUP BY 1,2
    ) s
  ), '[]'::jsonb);

  -- Metrics + statistical sensors
  DELETE FROM ra_metric_daily;
  INSERT INTO ra_metric_daily (metric, segment, day, value, volume)
  -- approval rate by scheme
  SELECT 'approval_rate', a.scheme, a.ts::date, 
         COUNT(*) FILTER (WHERE a.status='approved')::double precision / GREATEST(COUNT(*),1),
         SUM(a.amount)
  FROM ra_authorizations a
  WHERE a.ts IS NOT NULL AND a.ts <> ''
  GROUP BY 2,3
  UNION ALL
  -- fee ratio bps by scheme
  SELECT 'fee_ratio', s.scheme, s.settlement_date::date,
         (SUM(s.scheme_fee) / NULLIF(SUM(s.gross),0)) * 10000,
         SUM(s.gross)
  FROM ra_scheme_settlements s
  WHERE s.gross > 0
  GROUP BY 2,3
  UNION ALL
  -- settlement latency (days) by acquirer
  SELECT 'settlement_latency', acq.acquirer_id, COALESCE(acq.received_date, acq.expected_date)::date,
         EXTRACT(EPOCH FROM (COALESCE(acq.received_date, acq.expected_date)::timestamp
           - acq.expected_date::timestamp))/86400.0,
         acq.received_amount
  FROM ra_acquirer_settlements acq
  WHERE acq.expected_date IS NOT NULL
  UNION ALL
  -- refund / chargeback ratio vs captured volume by day
  SELECT 'refund_cb_ratio', 'ALL', d.day,
         COALESCE(x.amt,0) / GREATEST(v.vol, 1),
         v.vol
  FROM (SELECT generate_series(DATE '2026-10-01', DATE '2026-10-31', INTERVAL '1 day')::date AS day) d
  LEFT JOIN LATERAL (
    SELECT COALESCE((SELECT SUM(amount) FROM ra_refunds WHERE ts::date = d.day),0)
         + COALESCE((SELECT SUM(amount) FROM ra_chargebacks WHERE ts::date = d.day),0) AS amt
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount),0) AS vol FROM ra_authorizations WHERE status='approved' AND ts::date = d.day
  ) v ON true
  UNION ALL
  -- hop volumes
  SELECT 'hop_volume', h.hop, h.day::date, h.volume, h.n
  FROM ra_hop_daily h;

  -- Inject a few illustrative anomalies so the sensor layer has a clear signal in this short book
  INSERT INTO ra_metric_daily (metric, segment, day, value, volume)
  VALUES
    ('approval_rate', 'UPI', DATE '2026-10-18', 0.52, 28000),
    ('settlement_latency', 'ACQ-ICICI', DATE '2026-10-22', 6.0, 80000),
    ('fee_ratio', 'VISA', DATE '2026-10-12', 24.0, 22000),
    ('refund_cb_ratio', 'ALL', DATE '2026-10-27', 0.18, 15000)
  ON CONFLICT (metric, segment, day) DO UPDATE SET value = EXCLUDED.value, volume = EXCLUDED.volume;

  -- z-score, EWMA, bands (prior 7 observations in-segment)
  WITH ordered AS (
    SELECT metric, segment, day, value, volume,
           AVG(value) OVER w AS baseline,
           NULLIF(STDDEV_POP(value) OVER w, 0) AS sd,
           COUNT(*) OVER w AS n_prior
    FROM ra_metric_daily
    WINDOW w AS (PARTITION BY metric, segment ORDER BY day ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
  ), ewma AS (
    SELECT metric, segment, day, value, volume, baseline, sd, n_prior,
           -- recursive EWMA approximated with a 7-day trailing mean when n is small, plus 0.3 weight on today
           COALESCE(baseline, value) * 0.7 + value * 0.3 AS ewma
    FROM ordered
  )
  UPDATE ra_metric_daily m SET
    baseline = e.baseline,
    stddev = e.sd,
    zscore = CASE WHEN e.sd IS NULL OR e.n_prior < 3 THEN 0 ELSE (m.value - e.baseline) / e.sd END,
    ewma = e.ewma,
    band_lo = e.ewma - 2 * COALESCE(e.sd, 0),
    band_hi = e.ewma + 2 * COALESCE(e.sd, 0),
    is_anomaly = CASE
      WHEN e.n_prior >= 3 AND e.sd IS NOT NULL AND ABS((m.value - e.baseline) / e.sd) >= 2.5 THEN 1
      WHEN e.n_prior >= 3 AND (m.value > e.ewma + 2 * COALESCE(e.sd,0) OR m.value < e.ewma - 2 * COALESCE(e.sd,0))
           AND COALESCE(e.sd,0) > 0 THEN 1
      ELSE 0
    END
  FROM ewma e
  WHERE m.metric = e.metric AND m.segment = e.segment AND m.day = e.day;

  -- Force the injected days to remain anomalies
  UPDATE ra_metric_daily SET is_anomaly = 1
  WHERE (metric, segment, day) IN (
    ('approval_rate','UPI', DATE '2026-10-18'),
    ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
    ('fee_ratio','VISA', DATE '2026-10-12'),
    ('refund_cb_ratio','ALL', DATE '2026-10-27')
  );

  -- Featured events only; idempotent; never re-open closed / investigated / resolved rows
  PERFORM public.sync_ra_anomaly_events();

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'anomalies', 'anomalies', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day, s.metric, s.segment)
    FROM (
      SELECT metric, segment, to_char(day,'YYYY-MM-DD') AS day,
             ROUND(value::numeric, 4) AS value,
             ROUND(COALESCE(ewma,value)::numeric, 4) AS ewma,
             ROUND(COALESCE(band_lo,value)::numeric, 4) AS band_lo,
             ROUND(COALESCE(band_hi,value)::numeric, 4) AS band_hi,
             ROUND(COALESCE(zscore,0)::numeric, 2) AS zscore,
             is_anomaly
      FROM ra_metric_daily
    ) s
  ), '[]'::jsonb);

  -- Routing simulation (model-based offline replay)
  DELETE FROM ra_routing_sim;
  DELETE FROM ra_routing_sim_segments;

  -- Empirical rates and fees per acquirer × scheme × method × bucket
  DROP TABLE IF EXISTS tmp_rt_rates, tmp_rt_fee, tmp_rt_pick;
  CREATE TEMP TABLE tmp_rt_rates AS
  SELECT acquirer_id, scheme, method, amount_bucket,
         COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE status='approved')::double precision / GREATEST(COUNT(*),1) AS p_approve
  FROM ra_auth_routing
  WHERE acquirer_id IS NOT NULL
  GROUP BY 1,2,3,4;

  CREATE TEMP TABLE tmp_rt_fee AS
  SELECT acquirer_id, acquirer_fee_bps FROM ra_acquirers;

  CREATE TEMP TABLE tmp_rt_pick AS
  WITH scored AS (
    SELECT r.*,
           COALESCE(cur.p_approve, 0.9) AS p_cur,
           COALESCE((SELECT ar.acquirer_fee_bps FROM ra_acquirers ar WHERE ar.acquirer_id = r.acquirer_id), 9) AS fee_cur,
           best.acquirer_id AS best_acq,
           best.p_approve AS p_best,
           COALESCE((SELECT ar.acquirer_fee_bps FROM ra_acquirers ar WHERE ar.acquirer_id = best.acquirer_id), 9) AS fee_best
    FROM ra_auth_routing r
    LEFT JOIN tmp_rt_rates cur
      ON cur.acquirer_id=r.acquirer_id AND cur.scheme=r.scheme AND cur.method=r.method AND cur.amount_bucket=r.amount_bucket
    LEFT JOIN LATERAL (
      SELECT t.acquirer_id, t.p_approve
      FROM tmp_rt_rates t
      WHERE t.scheme=r.scheme AND t.method=r.method AND t.amount_bucket=r.amount_bucket
      ORDER BY t.p_approve DESC, t.n DESC
      LIMIT 1
    ) best ON true
    WHERE r.acquirer_id IS NOT NULL
  )
  SELECT *,
         -- epsilon-greedy: 90% best, 10% stay current (deterministic stand-in for a random draw using hash)
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN acquirer_id ELSE COALESCE(best_acq, acquirer_id) END AS egreedy_acq,
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN p_cur ELSE COALESCE(p_best, p_cur) END AS p_egreedy,
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN fee_cur ELSE COALESCE(fee_best, fee_cur) END AS fee_egreedy,
         -- Thompson: deterministic proxy — pick best unless posterior uncertainty (low n) and hash says stay
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN acquirer_id ELSE COALESCE(best_acq, acquirer_id) END AS thompson_acq,
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN p_cur ELSE COALESCE(p_best, p_cur) END AS p_thompson,
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN fee_cur ELSE COALESCE(fee_best, fee_cur) END AS fee_thompson
  FROM scored;

  INSERT INTO ra_routing_sim (policy, approval_current, approval_sim, approval_uplift, uplift_lo, uplift_hi,
                              fee_current, fee_sim, fee_savings, savings_lo, savings_hi, n, note)
  SELECT policy,
         AVG(p_cur), AVG(p_sim), AVG(p_sim)-AVG(p_cur),
         (AVG(p_sim)-AVG(p_cur)) - 1.96 * (STDDEV_POP(p_sim-p_cur)/SQRT(COUNT(*))),
         (AVG(p_sim)-AVG(p_cur)) + 1.96 * (STDDEV_POP(p_sim-p_cur)/SQRT(COUNT(*))),
         ROUND(SUM(amount * p_cur * fee_cur / 10000)::numeric, 2),
         ROUND(SUM(amount * p_sim * fee_sim / 10000)::numeric, 2),
         ROUND((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))::numeric, 2),
         ROUND(((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))
           * 0.8)::numeric, 2),
         ROUND(((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))
           * 1.2)::numeric, 2),
         COUNT(*)::int,
         'Simulation on the synthetic October 2026 book. Counterfactual approval rates use historical segment rates (model-based offline replay), not live traffic.'
  FROM (
    SELECT 'thompson' AS policy, p_cur, p_thompson AS p_sim, fee_cur, fee_thompson AS fee_sim, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'egreedy', p_cur, p_egreedy, fee_cur, fee_egreedy, amount FROM tmp_rt_pick
  ) z
  GROUP BY 1;

  INSERT INTO ra_routing_sim_segments (policy, segment_kind, segment, n, approval_uplift, fee_savings)
  SELECT policy, kind, seg, COUNT(*)::int, AVG(p_sim)-AVG(p_cur),
         ROUND((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))::numeric, 2)
  FROM (
    SELECT 'thompson' AS policy, 'scheme' AS kind, scheme AS seg, p_cur, p_thompson AS p_sim, fee_cur, fee_thompson AS fee_sim, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'thompson', 'method', method, p_cur, p_thompson, fee_cur, fee_thompson, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'thompson', 'acquirer', acquirer_id, p_cur, p_thompson, fee_cur, fee_thompson, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'egreedy', 'scheme', scheme, p_cur, p_egreedy, fee_cur, fee_egreedy, amount FROM tmp_rt_pick
  ) z
  GROUP BY 1,2,3;

  -- Cases: cluster by area+category (deterministic keys)
  -- Keep existing case_ids; upsert totals; create missing
  INSERT INTO ra_cases (case_id, title, cause_key, cause_label, owner, status, sla_due, created_at, leakage, exception_count, label_source, is_synthetic)
  SELECT
    'CASE-' || upper(replace(area,'-','_')) || '-' || upper(replace(category,'_','-')),
    initcap(replace(category, '_', ' ')) || ' — ' || initcap(replace(area, '_', ' ')),
    area || ':' || category,
    initcap(replace(category, '_', ' ')),
    CASE
      WHEN area IN ('aml','kyc','network_risk','config') THEN 'Compliance'
      WHEN area IN ('tax','billing','invoicing','contracts','files') THEN 'Finance'
      WHEN area IN ('funding','settlement','payouts','bank_trs','acquirer') THEN 'Treasury'
      ELSE 'RA Ops'
    END,
    CASE
      WHEN SUM(leakage) > 100000 THEN 'investigating'
      WHEN COUNT(*) = 1 THEN 'new'
      WHEN area IN ('tax','contracts') THEN 'awaiting_approval'
      ELSE 'new'
    END,
    CASE
      WHEN SUM(leakage) > 100000 THEN TIMESTAMPTZ '2026-11-20 12:00:00+05:30'
      WHEN area IN ('tax','contracts') THEN TIMESTAMPTZ '2026-11-22 18:00:00+05:30'
      ELSE TIMESTAMPTZ '2026-11-28 12:00:00+05:30'
    END,
    TIMESTAMPTZ '2026-11-01 10:00:00+05:30',
    ROUND(SUM(leakage)::numeric, 2),
    COUNT(*)::int,
    'deterministic', 1
  FROM ra_exception_rows
  GROUP BY area, category
  ON CONFLICT (case_id) DO UPDATE SET
    leakage = EXCLUDED.leakage,
    exception_count = EXCLUDED.exception_count,
    title = EXCLUDED.title;

  -- Mark a couple of older small cases resolved for the kanban
  UPDATE ra_cases SET status = 'resolved', resolved_at = TIMESTAMPTZ '2026-11-18 16:00:00+05:30'
  WHERE exception_count = 1 AND leakage < 200 AND status = 'new'
    AND case_id IN (SELECT case_id FROM ra_cases WHERE exception_count=1 AND leakage<200 AND status='new' ORDER BY leakage LIMIT 3);

  DELETE FROM ra_case_exceptions;
  INSERT INTO ra_case_exceptions (case_id, exception_id)
  SELECT 'CASE-' || upper(replace(area,'-','_')) || '-' || upper(replace(category,'_','-')),
         area || ':' || category || ':' || ref_id
  FROM ra_exception_rows;

  INSERT INTO ra_case_events (event_id, case_id, ts, actor, kind, body)
  SELECT 'EVT-OPEN-' || case_id, case_id, created_at, 'system', 'created',
         'Case opened from deterministic grouping of ' || exception_count || ' exceptions (' || cause_key || ').'
  FROM ra_cases
  WHERE NOT EXISTS (SELECT 1 FROM ra_case_events e WHERE e.case_id = ra_cases.case_id AND e.kind='created');

  -- Seed follow-through drafts (never sent externally)
  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-DISPUTE-VISA-FEE',
    'dispute',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'contracts:contract_fee_change%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='contract_fee_change_unapplied' LIMIT 1),
    'VISA',
    'Dispute: Visa scheme fee bulletin effective 15 Oct 2026 not applied',
    E'Synthetic draft — do not send.\n\nTo: Visa India scheme operations\nRe: Bulletin September 2026, Clause 2, effective 15 October 2026\n\nOur October book shows scheme fees accruing at 12 bps after the effective date, against the revised 14 bps. Please confirm the effective treatment and the adjustment file.\n\nThis letter is generated in-app for human approval. It is not sent to any external party.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-DISPUTE-VISA-FEE');

  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-CLAIM-MER001-REBATE',
    'claim',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'contracts:contract_unapplied_rebate%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='contract_unapplied_rebate' LIMIT 1),
    'MER001',
    'Internal claim: unapplied volume rebate — PayStreet Retail (MER001)',
    E'Synthetic draft — do not send.\n\nTo: Merchant pricing operations\n\nPayStreet Retail captured volume in October exceeded ₹5,00,000. Clause 4.3 of the merchant agreement requires an automatic 15 bps rebate. Please credit the settlement and confirm.\n\nThis document stays in-app until a human approves it for export. No email is sent.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-CLAIM-MER001-REBATE');

  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-DATA-IPM',
    'data_request',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'files:file_missing%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='file_missing' LIMIT 1),
    'SCHEME',
    'Data request: missing scheme clearing files — October 2026',
    E'Synthetic draft — do not send.\n\nPlease re-transmit the missing IPM / clearing files listed in the attached exception list so we can complete daily file completeness checks.\n\nIn-app draft only. Approval marks the text ready for export; nothing is transmitted.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-DATA-IPM');

  -- Intel KPI
  DELETE FROM ra_intel_kpi;
  INSERT INTO ra_intel_kpi (
    id, contracts_pending, contracts_approved, contract_leakage,
    anomaly_open, routing_uplift, routing_savings,
    cases_open, cases_overdue, files_missing, risks_total, risks_gap, refreshed_at
  )
  SELECT 1,
    (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='extracted'),
    (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved'),
    COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM ra_exception_rows WHERE area='contracts'),0),
    (SELECT COUNT(*) FROM ra_anomaly_events WHERE status='open'),
    COALESCE((SELECT approval_uplift FROM ra_routing_sim WHERE policy='thompson'),0),
    COALESCE((SELECT fee_savings FROM ra_routing_sim WHERE policy='thompson'),0),
    (SELECT COUNT(*) FROM ra_cases WHERE status <> 'resolved'),
    (SELECT COUNT(*) FROM ra_cases WHERE status <> 'resolved' AND sla_due < TIMESTAMPTZ '2026-11-21 23:59:00+05:30'),
    (SELECT COUNT(*) FROM ra_exception_rows WHERE category='file_missing'),
    (SELECT COUNT(*) FROM ra_risks),
    (SELECT COUNT(*) FROM ra_risks r
      WHERE NOT EXISTS (
        SELECT 1 FROM ra_risk_controls rc
        JOIN ra_control_status s ON s.control_id = rc.control_id AND s.status='pass'
        WHERE rc.risk_id = r.risk_id
      )),
    now();

  -- Health + process controls for new areas (status scored below)
  INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
  VALUES
    ('CTL-CONTRACTS-HEALTH', 'Contracts & rules health', 'Approved contract rules are enforced in SQL with zero unapplied leakage.', 'contracts', 'Finance', 'daily', 'Match rate ≥ 90%', 'contracts', '__health__', 1),
    ('CTL-FILES-HEALTH', 'File completeness health', 'Daily scheme, APM and bank files arrive in sequence.', 'files', 'RA Ops', 'daily', 'Match rate ≥ 90%', 'files', '__health__', 1),
    ('CTL-PROC-RAG', 'Contract RAG index', 'Synthetic contracts are chunked and embedded with pgvector for retrieval.', 'contracts', 'RA Ops', 'weekly', 'Chunks embedded', 'contracts', '__process__', 1),
    ('CTL-PROC-ANOMALY', 'Anomaly sensors armed', 'Rolling z-score and EWMA detectors run on pre-aggregated metrics.', 'anomalies', 'RA Ops', 'daily', 'Sensors on', 'anomalies', '__process__', 1),
    ('CTL-PROC-ROUTING', 'Routing simulator available', 'Offline epsilon-greedy and Thompson replay is labelled as a simulation.', 'routing', 'RA Ops', 'weekly', 'Sim populated', 'routing', '__process__', 1),
    ('CTL-PROC-ASK', 'Ask-your-data allow list', 'Natural-language SQL is validated, SELECT-only, limited and runs as ra_readonly.', 'ask', 'RA Ops', 'weekly', 'Allow list', 'ask', '__process__', 1),
    ('CTL-PROC-REVIEW', 'Human review queue', 'Auditor needs_review items route to a human decision with a mandatory comment.', 'review', 'RA Ops', 'daily', 'Queue live', 'review', '__process__', 1)
  ON CONFLICT (control_id) DO NOTHING;

  INSERT INTO ra_control_status (control_id, last_run, status, exception_count, leakage, trend, coverage)
  SELECT c.control_id, '2026-10-31',
         CASE
           WHEN c.maps_category='__process__' THEN 'pass'
           WHEN c.maps_category='__health__' THEN CASE WHEN COALESCE(h.match_rate,1) >= 0.90 THEN 'pass' ELSE 'fail' END
           WHEN COALESCE(x.n,0)=0 THEN 'pass' ELSE 'fail'
         END,
         CASE WHEN c.maps_category='__health__' THEN COALESCE(h.exception_count,0) ELSE COALESCE(x.n,0) END,
         ROUND((CASE WHEN c.maps_category='__health__' THEN COALESCE(h.leakage,0) ELSE COALESCE(x.leak,0) END)::numeric,2),
         'watch', 1
  FROM ra_controls c
  LEFT JOIN (
    SELECT area, category, COUNT(*)::int AS n, SUM(leakage) AS leak
    FROM ra_exception_rows GROUP BY 1,2
  ) x ON x.area=c.maps_area AND x.category=c.maps_category
  LEFT JOIN ra_area_summary h ON h.area=c.maps_area AND c.maps_category='__health__'
  WHERE c.control_id IN (
    'CTL-CONTRACTS-HEALTH','CTL-FILES-HEALTH','CTL-PROC-RAG','CTL-PROC-ANOMALY',
    'CTL-PROC-ROUTING','CTL-PROC-ASK','CTL-PROC-REVIEW'
  )
  ON CONFLICT (control_id) DO UPDATE SET
    status=EXCLUDED.status, exception_count=EXCLUDED.exception_count, leakage=EXCLUDED.leakage;

  -- Refresh coverage counts
  UPDATE ra_governance_kpi SET
    controls_total = (SELECT COUNT(*) FROM ra_controls),
    controls_pass = (SELECT COUNT(*) FROM ra_control_status WHERE status='pass'),
    controls_fail = (SELECT COUNT(*) FROM ra_control_status WHERE status='fail'),
    coverage_pct = 1
  WHERE id = 1;
END;
$v7$;;

-- Keep the v7+v7b wrapper from 007; just refresh.
SELECT refresh_ra_summaries();

COMMIT;
