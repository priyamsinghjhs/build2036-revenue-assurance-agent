-- Pre-aggregated dashboard tables. Request paths read ONLY these (plus tiny
-- ra_exception_rows lookups). Heavy recon views are evaluated here once.

BEGIN;

CREATE TABLE IF NOT EXISTS ra_kpi_summary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_leakage DOUBLE PRECISION NOT NULL,
  recovery_potential DOUBLE PRECISION NOT NULL,
  match_rate DOUBLE PRECISION NOT NULL,
  exception_count INTEGER NOT NULL,
  auth_count INTEGER NOT NULL,
  merchant_count INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ra_area_summary (
  area TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  matched INTEGER NOT NULL,
  unmatched INTEGER NOT NULL,
  variance INTEGER NOT NULL,
  leakage DOUBLE PRECISION NOT NULL,
  match_rate DOUBLE PRECISION NOT NULL,
  exception_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_leakage_category (
  area TEXT NOT NULL,
  category TEXT NOT NULL,
  n INTEGER NOT NULL,
  leakage DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (area, category)
);

CREATE TABLE IF NOT EXISTS ra_leakage_trend (
  day TEXT PRIMARY KEY,
  leakage DOUBLE PRECISION NOT NULL,
  n INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_money_flow (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  capture DOUBLE PRECISION NOT NULL,
  gateway_fees DOUBLE PRECISION NOT NULL,
  scheme_gross DOUBLE PRECISION NOT NULL,
  scheme_net DOUBLE PRECISION NOT NULL,
  bank DOUBLE PRECISION NOT NULL,
  payout DOUBLE PRECISION NOT NULL,
  leakage_by_area JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_area_series (
  area TEXT PRIMARY KEY,
  series_type TEXT NOT NULL,
  points JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_system_map_nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lane TEXT NOT NULL,
  href TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_system_map_edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  href TEXT NOT NULL,
  label TEXT NOT NULL,
  leakage DOUBLE PRECISION NOT NULL,
  match_rate DOUBLE PRECISION NOT NULL,
  exceptions INTEGER NOT NULL,
  PRIMARY KEY (source, target, label)
);

CREATE INDEX IF NOT EXISTS idx_ra_ex_area_leak ON ra_exception_rows (area, leakage DESC);
CREATE INDEX IF NOT EXISTS idx_ra_ex_lookup ON ra_exception_rows (area, category, ref_id);

INSERT INTO ra_system_map_nodes (id, label, lane, href, x, y) VALUES
  ('crm', 'CRM / Contract', 'origin', '/billing', 0, 40),
  ('tms', 'POS / TMS', 'origin', '/terminals', 0, 140),
  ('gateway', 'Payment Gateway', 'acquire', '/authorization', 200, 20),
  ('switch', 'Switch / Auth Host', 'acquire', '/authorization', 200, 120),
  ('apm', 'APM Providers', 'acquire', '/apm', 200, 220),
  ('fx', 'FX Provider', 'acquire', '/fx', 200, 320),
  ('clearing', 'Clearing TC33/IPM', 'scheme', '/scheme', 420, 40),
  ('scheme', 'Scheme Settlement', 'scheme', '/scheme', 420, 140),
  ('scheme_inv', 'Scheme Fee Invoices', 'scheme', '/vendors', 420, 240),
  ('bank', 'Sponsor Bank MT940', 'bank', '/bank', 640, 40),
  ('trs', 'TRS Treasury', 'bank', '/bank', 640, 140),
  ('payouts', 'Payouts / Reserves', 'bank', '/payouts', 640, 240),
  ('billing', 'Billing / Rating', 'finance', '/billing', 860, 20),
  ('invoicing', 'Invoicing + GST', 'finance', '/invoicing', 860, 120),
  ('cash', 'Cash / AR', 'finance', '/cash', 860, 220),
  ('vendor', 'Vendor AP', 'finance', '/vendors', 860, 320),
  ('gl', 'GL / ERP', 'finance', '/gl', 1080, 160),
  ('disputes', 'Chargebacks', 'risk', '/chargebacks', 1080, 300)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, href = EXCLUDED.href, x = EXCLUDED.x, y = EXCLUDED.y;

CREATE OR REPLACE FUNCTION ra_edge_stats(src_sql TEXT)
RETURNS TABLE (leakage DOUBLE PRECISION, match_rate DOUBLE PRECISION, exceptions INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
  matched INTEGER := 0;
  unmatched INTEGER := 0;
  leak DOUBLE PRECISION := 0;
  total INTEGER;
BEGIN
  -- Cast leakage so dynamic queries whose SUM() is numeric vs real
  -- do not trip PL/pgSQL's cached plan (42804).
  FOR rec IN EXECUTE
    'SELECT status, n::int AS n, COALESCE(leakage, 0)::double precision AS leakage FROM (' || src_sql || ') _s'
  LOOP
    leak := leak + rec.leakage;
    IF rec.status = 'matched' THEN
      matched := matched + rec.n;
    ELSE
      unmatched := unmatched + rec.n;
    END IF;
  END LOOP;
  total := matched + unmatched;
  leakage := ROUND(leak::numeric, 2);
  match_rate := CASE WHEN total = 0 THEN 1 ELSE matched::double precision / total END;
  exceptions := unmatched;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_ra_summaries() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Area match-rate rollups (run once after seed / when book changes)
  DELETE FROM ra_area_summary;
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT x.area, x.label,
         x.matched, x.unmatched, x.variance,
         ROUND(x.leakage::numeric, 2),
         CASE WHEN x.total = 0 THEN 1 ELSE x.matched::double precision / x.total END,
         x.unmatched + x.variance
  FROM (
    SELECT s.area, s.label,
           SUM(s.matched) matched, SUM(s.unmatched) unmatched, SUM(s.variance) variance,
           SUM(s.leakage) leakage, SUM(s.matched + s.unmatched + s.variance) total
    FROM (
      SELECT 'authorization' area, 'Authorization & Capture' label,
             CASE WHEN status = 'matched' THEN n ELSE 0 END matched,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END unmatched,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END variance,
             COALESCE(leakage,0)::double precision leakage
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_auth_capture GROUP BY status) q
      UNION ALL
      SELECT 'scheme', 'Scheme Settlement',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_capture_scheme
              UNION ALL SELECT status, leakage FROM v_ra_scheme_fee_var
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'bank_trs', 'Bank / TRS',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_scheme_bank
              UNION ALL SELECT status, leakage FROM v_ra_bank_unidentified
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'gateway', 'Gateway Charges',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_gateway GROUP BY status) q
      UNION ALL
      SELECT 'network', 'Network Fees',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_network GROUP BY status) q
      UNION ALL
      SELECT 'partner', 'Partner Fees',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_partner GROUP BY status) q
      UNION ALL
      SELECT 'terminal', 'POS Terminals',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_terminal_recon GROUP BY status) q
      UNION ALL
      SELECT 'apm', 'Alternative Payments',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_apm GROUP BY status) q
      UNION ALL
      SELECT 'fx', 'FX & Currency',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fx GROUP BY status) q
      UNION ALL
      SELECT 'pricing', 'Merchant Pricing',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_pricing GROUP BY status) q
      UNION ALL
      SELECT 'payouts', 'Payouts & Reserves',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_payouts GROUP BY status) q
      UNION ALL
      SELECT 'chargebacks', 'Chargebacks & Refunds',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_chargebacks GROUP BY status) q
      UNION ALL
      SELECT 'billing', 'Billing / Rating',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_contract_billing
              UNION ALL SELECT status, leakage FROM v_ra_usage_billing
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'invoicing', 'Invoicing',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_billing_invoice
              UNION ALL SELECT status, leakage FROM v_ra_invoice_tax
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'cash_ar', 'Cash & AR',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_invoice_cash
              UNION ALL SELECT status, leakage FROM v_ra_unapplied_cash
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'vendor', 'Vendor Costs',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_vendor_cost
              UNION ALL SELECT status, leakage FROM v_ra_vendor_pay
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'gl', 'GL / ERP',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_gl_unposted
              UNION ALL SELECT status, leakage FROM v_ra_gl_invoice
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'hops', 'System hops',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_gateway_switch
              UNION ALL SELECT status, leakage FROM v_ra_switch_orphan
              UNION ALL SELECT status, leakage FROM v_ra_bank_trs
            ) z GROUP BY status) q
    ) s
    GROUP BY s.area, s.label
  ) x;

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

  DELETE FROM ra_money_flow;
  INSERT INTO ra_money_flow (id, capture, gateway_fees, scheme_gross, scheme_net, bank, payout, leakage_by_area)
  SELECT 1,
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_captures), 0),
         COALESCE((SELECT ROUND(SUM(invoiced)::numeric, 2) FROM ra_gateway_charges), 0),
         COALESCE((SELECT ROUND(SUM(gross)::numeric, 2) FROM ra_scheme_settlements), 0),
         COALESCE((SELECT ROUND(SUM(net)::numeric, 2) FROM ra_scheme_settlements), 0),
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_bank_transactions WHERE recon_ref IS NOT NULL), 0),
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_payouts), 0),
         COALESCE((SELECT jsonb_object_agg(area, v) FROM (
           SELECT area, ROUND(SUM(leakage)::numeric, 2) AS v FROM ra_exception_rows GROUP BY area
         ) l), '{}'::jsonb);

  DELETE FROM ra_kpi_summary;
  INSERT INTO ra_kpi_summary (id, total_leakage, recovery_potential, match_rate, exception_count, auth_count, merchant_count)
  SELECT 1,
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows), 0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows), 0),
         COALESCE((SELECT CASE WHEN SUM(matched+unmatched+variance)=0 THEN 1
           ELSE SUM(matched)::double precision / SUM(matched+unmatched+variance) END FROM ra_area_summary), 1),
         COALESCE((SELECT COUNT(*) FROM ra_exception_rows), 0),
         COALESCE((SELECT COUNT(*) FROM ra_authorizations), 0),
         COALESCE((SELECT COUNT(*) FROM ra_merchants), 0);

  DELETE FROM ra_area_series;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'billing', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT charge_type AS name, ROUND(SUM(expected_amount)::numeric,2) AS expected, ROUND(SUM(amount)::numeric,2) AS billed
        FROM ra_billing_lines GROUP BY 1 ORDER BY billed DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'invoicing', 'scheme', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT merchant_id AS name, ROUND(subtotal::numeric,2) AS invoiced, ROUND(gst_amount::numeric,2) AS gst, ROUND(total::numeric,2) AS total
        FROM ra_fin_invoices ORDER BY invoice_date) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'cash_ar', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT category AS name, ROUND(SUM(leakage)::numeric,2) AS value, COUNT(*) AS n
        FROM v_ra_ar_ageing GROUP BY 1 ORDER BY 2 DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'vendor', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT vendor_type AS name, ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced
        FROM ra_vendor_invoices GROUP BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'gl', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT CASE WHEN posted=1 THEN 'posted' ELSE 'unposted' END AS name,
               COUNT(*) AS n,
               ROUND(SUM((SELECT SUM(debit) FROM ra_gl_lines l WHERE l.journal_id = j.journal_id))::numeric,2) AS value
        FROM ra_gl_journals j GROUP BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'hops', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT area || ' ' || category AS name, ROUND(SUM(leakage)::numeric,2) AS value, COUNT(*) AS n
        FROM ra_exception_rows WHERE area = 'hops' GROUP BY 1 ORDER BY 2 DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'fx', 'fx', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT SUBSTR(ts, 1, 10) AS day, ROUND(AVG(applied_rate)::numeric, 4) AS applied, ROUND(AVG(reference_rate)::numeric, 4) AS reference
        FROM ra_fx_conversions GROUP BY 1 ORDER BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'terminal', 'terminals', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT status, COUNT(*) n, ROUND(SUM(monthly_rental)::numeric, 2) rental FROM ra_terminals GROUP BY status) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'apm', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT method, provider, ROUND(SUM(amount)::numeric, 2) AS amount FROM ra_apm_reports GROUP BY method, provider ORDER BY amount DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'partner', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_partner_fees) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'gateway', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_gateway_charges) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'network', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_network_fees) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'scheme', 'scheme', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT scheme, COUNT(*) n, ROUND(SUM(gross)::numeric,2) gross, ROUND(SUM(interchange + scheme_fee)::numeric,2) fees, ROUND(SUM(net)::numeric,2) net
        FROM ra_scheme_settlements GROUP BY scheme ORDER BY gross DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT area, 'trend', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.day) FROM ra_leakage_trend t), '[]'::jsonb)
  FROM (VALUES
    ('authorization'),('bank_trs'),('pricing'),('payouts'),('chargebacks')
  ) v(area);

  DELETE FROM ra_system_map_edges;
  INSERT INTO ra_system_map_edges (source, target, href, label, leakage, match_rate, exceptions)
  SELECT d.source, d.target, d.href, d.label, s.leakage, s.match_rate, s.exceptions
  FROM (VALUES
    ('crm','billing','/billing','contract↔rating', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_contract_billing GROUP BY status'),
    ('tms','billing','/terminals','rental usage', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_terminal_recon GROUP BY status'),
    ('gateway','switch','/authorization','gateway↔switch', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gateway_switch GROUP BY status'),
    ('switch','clearing','/scheme','switch↔IPM', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_switch_clearing GROUP BY status'),
    ('clearing','scheme','/scheme','clearing↔scheme', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_capture_scheme GROUP BY status'),
    ('scheme','bank','/bank','scheme↔MT940', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_scheme_bank GROUP BY status'),
    ('bank','trs','/bank','MT940↔TRS', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_bank_trs GROUP BY status'),
    ('trs','gl','/gl','TRS↔GL', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gl_unposted GROUP BY status'),
    ('apm','scheme','/apm','APM reports', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_apm GROUP BY status'),
    ('fx','billing','/fx','FX rates', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fx GROUP BY status'),
    ('switch','billing','/billing','usage↔billed', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_usage_billing GROUP BY status'),
    ('billing','invoicing','/invoicing','billing↔invoice', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_billing_invoice GROUP BY status'),
    ('invoicing','cash','/cash','invoice↔cash', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_invoice_cash GROUP BY status'),
    ('cash','gl','/gl','AR↔GL', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gl_invoice GROUP BY status'),
    ('scheme_inv','vendor','/vendors','scheme invoices', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_vendor_cost GROUP BY status'),
    ('vendor','gl','/vendors','AP vs payments', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_vendor_pay GROUP BY status'),
    ('trs','payouts','/payouts','net vs payout', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_payouts GROUP BY status'),
    ('scheme','disputes','/chargebacks','chargebacks', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_chargebacks GROUP BY status')
  ) AS d(source, target, href, label, q)
  CROSS JOIN LATERAL ra_edge_stats(d.q) s;
END;
$$;

SELECT refresh_ra_summaries();

COMMIT;
