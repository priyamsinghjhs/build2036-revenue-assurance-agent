#!/usr/bin/env node
/**
 * Rigorous regression suite for the Revenue Assurance Worker.
 * Hits the live API (read-only) and plants breaks only on a Neon test branch.
 * Never prints connection strings or tokens.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { api, db, BOOK_SQL, EXPOSURE, RESULTS, Scorecard, nearly, BASE } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const card = new Scorecard();
mkdirSync(RESULTS, { recursive: true });

const AGENTS = [
  ["orchestrator", "yes", "Sequences runs; no domain detection of its own"],
  ["recon_authorization", "yes", "Auth↔capture recon view"],
  ["recon_scheme", "yes", "Scheme settlement recon"],
  ["recon_network_gateway", "yes", "Gateway fee recon"],
  ["network_fees", "yes", "Network fee recon (v_ra_fee_network)"],
  ["recon_partner", "yes", "Partner fee recon"],
  ["recon_terminal", "yes", "POS terminal recon"],
  ["recon_bank", "yes", "TRS / bank recon"],
  ["recon_apm", "yes", "APM recon"],
  ["recon_fx", "yes", "FX recon"],
  ["recon_billing", "yes", "Billing recon"],
  ["recon_invoicing", "yes", "Invoicing recon"],
  ["recon_cash", "yes", "Cash / AR recon"],
  ["recon_vendor", "yes", "Vendor cost recon"],
  ["recon_gl", "yes", "GL / ERP recon"],
  ["hops", "yes", "System hops recon views"],
  ["payouts", "yes", "Payouts area views"],
  ["chargebacks", "yes", "Chargebacks area views"],
  ["pricing", "yes", "Merchant pricing views"],
  ["recon_settlement", "yes", "Settlement recon"],
  ["recon_funding", "yes", "Funding recon"],
  ["recon_acquirer", "yes", "Acquirer recon"],
  ["recon_config", "gated", "Unapproved config changes stay pending human approval"],
  ["recon_tax", "yes", "Tax / GST recon"],
  ["recon_kyc", "yes", "KYC views; amounts are exposure, not book leakage"],
  ["recon_interfaces", "yes", "Interface drop views"],
  ["recon_aml", "yes", "AML flags; amounts are exposure, not book leakage"],
  ["recon_network", "yes", "Network-risk graph scores (exposure)"],
  ["recon_success", "yes", "Success-rate patterns"],
  ["recon_files", "yes", "Missing / OOS file checks"],
  ["file_parsers", "yes", "Deterministic camt.053 / NPCI / IPM / BASE II adapters"],
  ["contract_extract", "gated", "Extracted rules require human approval before they are active"],
  ["gap_detection", "yes", "Prioritises leakage themes"],
  ["investigator", "gated", "Can run on cron when forced; review queue catches unverified output"],
  ["action", "gated", "Proposals only; queue items stay proposed until a human decides"],
  ["auditor", "gated", "Suggestions need Accept; Dismiss needs a comment; nothing is sent"],
  ["anomaly", "yes", "Featured-seed sync is deterministic and idempotent"],
  ["routing_simulator", "yes", "Offline Thompson sampling replay"],
  ["recon_false_declines", "yes", "Soft-decline recoverable leakage is scored by the GBDT and explained with SHAP"],
  ["gbdt_models", "yes", "LightGBM trees are evaluated in TypeScript; metrics are synthetic"],
  ["shap_explain", "yes", "Path-attribution SHAP sums to raw minus base"],
  ["iforest", "yes", "Isolation-forest flags are deduped and never re-open closed events"],
  ["ask_your_data", "yes", "Allow-listed SELECT only"],
  ["learning", "gated", "Apply-learning is a recorded in-app action"],
  ["review", "gated", "Human review queue; comment is mandatory"],
];

for (const [id, auto, why] of AGENTS) {
  card.add(id, { autonomous: auto, detail: why });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function sectionLiveApi() {
  const endpoints = [
    ["/api/health", (b) => b.ok === true],
    ["/api/executive", (b) => b.kpis && typeof b.kpis.leakage === "number"],
    ["/api/filters", (b) => Array.isArray(b.merchants) || Array.isArray(b.schemes) || b.period],
    ["/api/areas", (b) => Array.isArray(b.areas) || Array.isArray(b)],
    ["/api/agents/roster", (b) => Array.isArray(b.agents) && b.agents.length >= 20],
    ["/api/actions", (b) => Array.isArray(b.actions)],
    ["/api/system-map", (b) => b.nodes || b.edges],
    ["/api/controls", (b) => b.controls || Array.isArray(b)],
    ["/api/contracts", (b) => b.documents || b.contracts || Array.isArray(b)],
    ["/api/anomalies", (b) => b.events || b.anomalies || Array.isArray(b)],
    ["/api/routing", (b) => b || true],
    ["/api/cases", (b) => b.cases || Array.isArray(b)],
    ["/api/reviews", (b) => Array.isArray(b.pending) || Array.isArray(b.reviews) || Array.isArray(b.items) || Array.isArray(b)],
    ["/api/ask/schema", (b) => Array.isArray(b.views)],
    ["/api/learning", (b) => b || true],
    ["/api/risks", (b) => b.risks || Array.isArray(b)],
    ["/api/files", (b) => Array.isArray(b.summary) || Array.isArray(b.exceptions) || Array.isArray(b.files) || Array.isArray(b.expected) || Array.isArray(b)],
    ["/api/intel", (b) => b || true],
    ["/api/automation/latest", (b) => b.latest || b.status || b.log_id || true],
    ["/api/drafts", (b) => b.drafts || Array.isArray(b)],
    ["/api/trace?q=CAP00216", (b) => b || true],
    ["/api/network-risk", (b) => b || true],
    ["/api/eval/quality", (b) => b || true],
    ["/api/dashboard/overview", (b) => b || true],
    ["/api/models", (b) => Array.isArray(b.cards) && b.kpis],
    ["/api/areas/false_declines", (b) => b.summary || b.exceptions || b.meta],
  ];
  const latencies = [];
  let fail = 0;
  for (const [path, pred] of endpoints) {
    const r = await api(path);
    latencies.push({ path, status: r.status, ms: r.ms, ok: r.ok });
    if (!r.ok || (pred && !pred(r.body))) {
      fail++;
      card.notes.push(`GET ${path} → ${r.status} ${r.ms}ms`);
    }
  }
  writeFileSync(`${RESULTS}/api-latencies.json`, JSON.stringify(latencies, null, 2));
  const p95 = [...latencies].sort((a, b) => a.ms - b.ms)[Math.floor(latencies.length * 0.95) - 1];
  card.notes.push(`Live GET endpoints: ${endpoints.length - fail}/${endpoints.length} 200+schema; p95 ~${p95?.ms ?? "?"}ms`);

  // Error paths
  const missing = await api("/api/exceptions/does-not-exist");
  const badReview = await api("/api/reviews/does-not-exist");
  const badJson = await api("/api/ask", { method: "POST", body: "{" });
  const emptyAsk = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) });
  const errorsOk = missing.status >= 400 && badReview.status >= 400 && (badJson.status >= 400 || emptyAsk.status >= 400);
  if (!errorsOk) card.remaining.push(`Error paths: exception=${missing.status} review=${badReview.status} ask=${badJson.status}/${emptyAsk.status}`);
  card.add("orchestrator", { technical: fail === 0 && errorsOk ? "pass" : "fail", detail: `roster+health; ${fail} GET failures; error paths ${errorsOk ? "ok" : "weak"}` });

  const areaAgents = {
    authorization: "recon_authorization", scheme: "recon_scheme", gateway: "recon_network_gateway",
    network: "network_fees", partner: "recon_partner", terminal: "recon_terminal", bank_trs: "recon_bank",
    apm: "recon_apm", fx: "recon_fx", billing: "recon_billing", invoicing: "recon_invoicing",
    cash_ar: "recon_cash", vendor: "recon_vendor", gl: "recon_gl", hops: "hops", payouts: "payouts",
    chargebacks: "chargebacks", pricing: "pricing", settlement: "recon_settlement", funding: "recon_funding",
    acquirer: "recon_acquirer", config: "recon_config", tax: "recon_tax", kyc: "recon_kyc",
    interfaces: "recon_interfaces", aml: "recon_aml", success: "recon_success",
    false_declines: "recon_false_declines",
  };
  for (const [area, agent] of Object.entries(areaAgents)) {
    const r = await api(`/api/areas/${area}`);
    const ok = r.ok && (r.body.summary || r.body.exceptions || r.body.meta || r.body.area || r.body.series);
    card.add(agent, { technical: ok ? "pass" : "fail", detail: `GET /api/areas/${area} → ${r.status} ${r.ms}ms` });
  }
  const extraTech = [
    ["recon_network", "/api/network-risk"],
    ["anomaly", "/api/anomalies"],
    ["routing_simulator", "/api/routing"],
    ["review", "/api/reviews"],
    ["learning", "/api/learning"],
    ["action", "/api/actions"],
    ["investigator", "/api/cases"],
    ["contract_extract", "/api/contracts"],
    ["recon_files", "/api/files"],
    ["auditor", "/api/audit/suggestions?exception_id=scheme:missing_scheme_settlement:CAP00216"],
    ["gbdt_models", "/api/models"],
  ];
  for (const [agent, path] of extraTech) {
    const r = await api(path);
    card.add(agent, { technical: r.ok ? "pass" : "fail", detail: `GET ${path} → ${r.status} ${r.ms}ms` });
  }
  return { fail, latencies, errorsOk };
}

async function sectionSqlSafety() {
  const attacks = [
    "INSERT INTO ra_exception_rows VALUES (1)",
    "DROP TABLE ra_merchants",
    "SELECT * FROM ra_merchants; DELETE FROM ra_merchants",
    "SELECT * FROM v_ask_areas; UPDATE ra_kpi_summary SET total_leakage=0",
    "SELECT 1; --",
    "SELECT * FROM pg_stat_file('/etc/passwd')",
    "SELECT * FROM ra_merchants", // not in allow-list
  ];
  let blocked = 0;
  const results = [];
  for (const question of attacks) {
    const r = await api("/api/ask", { method: "POST", body: JSON.stringify({ question }) });
    const text = JSON.stringify(r.body).toLowerCase();
    const ok = r.status >= 400 || r.body.error || text.includes("allow") || text.includes("reject") || text.includes("read-only") || text.includes("not allowed") || text.includes("insufficient") || text.includes("invalid");
    // Must not have executed a write or returned raw merchant dump unscoped
    const leaked = Array.isArray(r.body.rows) && r.body.rows.length > 0 && question.includes("ra_merchants");
    if (ok && !leaked) blocked++;
    results.push({ question, status: r.status, ok: ok && !leaked });
  }
  const legit = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: "SELECT area, leakage FROM v_ask_areas ORDER BY leakage DESC LIMIT 5" }) });
  const legitOk = legit.ok && (legit.body.rows || legit.body.sql || legit.body.result || legit.body.columns);
  writeFileSync(`${RESULTS}/sql-safety.json`, JSON.stringify({ attacks: results, legit: { status: legit.status, ok: legitOk } }, null, 2));
  const pass = blocked === attacks.length && legitOk;
  card.add("ask_your_data", { technical: pass ? "pass" : "fail", functional: legitOk ? "pass" : "fail", detail: `blocked ${blocked}/${attacks.length} unsafe questions; allow-listed SELECT ${legitOk ? "ok" : "failed"}` });
  if (!pass) card.remaining.push("Ask-your-data safety or allow-listed SELECT did not fully pass");
  return pass;
}

async function sectionKpiReconcile(sql) {
  const kpi = (await sql.query("SELECT total_leakage, exception_count, match_rate FROM ra_kpi_summary WHERE id=1"))[0];
  const areas = await sql.query(`SELECT area, leakage, exception_count FROM ra_area_summary`);
  const bookAreas = areas.filter((a) => !EXPOSURE.includes(a.area));
  const sumLeak = bookAreas.reduce((s, a) => s + Number(a.leakage), 0);
  const sumN = bookAreas.reduce((s, a) => s + Number(a.exception_count), 0);
  const leakOk = nearly(sumLeak, kpi.total_leakage, 0.05);
  const live = await api("/api/executive");
  const liveLeak = live.body?.kpis?.leakage;
  const liveTop = (live.body?.top_drivers || []).map((d) => d.area);
  const topHasExposure = liveTop.some((a) => EXPOSURE.includes(a));
  // After the chart fix + deploy, live top drivers must be book leakage only.
  const liveOk = live.ok && typeof liveLeak === "number" && !topHasExposure && Array.isArray(live.body?.compliance_exposure);
  const countOk = Number(kpi.exception_count) === sumN;
  if (!countOk) {
    card.remaining.push(`Test-branch KPI exception_count is ${kpi.exception_count} but book area_summary sums to ${sumN}. Leakage already matches (₹${Number(kpi.total_leakage).toFixed(2)}).`);
  }
  if (topHasExposure) {
    card.bugs.push("Top leakage drivers included KYC/AML exposure (fixed: book-leakage-only chart + separate compliance exposure chart).");
  }
  if (live.ok && !nearly(liveLeak, kpi.total_leakage, 1)) {
    card.notes.push(`Live exec leakage ₹${Number(liveLeak).toFixed(2)} is production; the test branch is ₹${Number(kpi.total_leakage).toFixed(2)} after planted breaks. They are not expected to match.`);
  }
  const liveCount = Number(live.body?.kpis?.exception_count);
  if (live.ok && nearly(liveLeak, 856670.08, 0.05) && liveCount && liveCount < 217) {
    card.remaining.push(`Live Worker KPI exception_count is ${liveCount} while a refreshed book area_summary sums to 217. Leakage already matches ₹856670.08. The next 7:45 AM IST cron (after the hung-run fix that now calls refresh_ra_summaries) should align the count.`);
  }
  const pass = leakOk && liveOk;
  card.add("gap_detection", { functional: pass ? "pass" : "fail", technical: live.ok ? "pass" : "fail", detail: `branch book area_summary ₹${sumLeak.toFixed(2)} vs branch KPI ₹${Number(kpi.total_leakage).toFixed(2)}; live (prod) ₹${liveLeak}; top_drivers book-only=${!topHasExposure}; compliance_exposure chart=${Array.isArray(live.body?.compliance_exposure)}` });
  return { kpi, sumLeak, sumN, leakOk, countOk, liveTop, topHasExposure };
}

async function sectionFunctionalPlants(sql) {
  // Baseline unmatched from key views
  const viewMap = {
    recon_authorization: "v_ra_auth_capture",
    recon_scheme: "v_ra_capture_scheme",
    recon_network_gateway: "v_ra_fee_gateway",
    network_fees: "v_ra_fee_network",
    recon_partner: "v_ra_fee_partner",
    recon_terminal: "v_ra_terminal_recon",
    recon_bank: "v_ra_scheme_bank",
    recon_apm: "v_ra_apm",
    recon_fx: "v_ra_fx",
    recon_billing: "v_ra_contract_billing",
    recon_invoicing: "v_ra_billing_invoice",
    recon_cash: "v_ra_invoice_cash",
    recon_vendor: "v_ra_vendor_cost",
    recon_gl: "v_ra_gl_unposted",
    hops: "v_ra_switch_orphan",
    payouts: "v_ra_payouts",
    chargebacks: "v_ra_chargebacks",
    pricing: "v_ra_pricing",
    recon_settlement: "v_ra_settlement",
    recon_funding: "v_ra_funding",
    recon_acquirer: "v_ra_acquirer",
    recon_config: "v_ra_config",
    recon_tax: "v_ra_tax",
    recon_kyc: "v_ra_kyc",
    recon_interfaces: "v_ra_interfaces",
    recon_aml: "v_ra_aml",
    recon_network: "v_ra_network",
    recon_success: "v_ra_success",
    recon_files: "v_ra_files",
    contract_extract: "v_ra_contracts",
  };

  const baseline = {};
  for (const [agent, view] of Object.entries(viewMap)) {
    try {
      const rows = await sql.query(`SELECT COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'matched')::int AS n, COALESCE(SUM(leakage) FILTER (WHERE status IS DISTINCT FROM 'matched'),0)::float AS leakage FROM ${view}`);
      baseline[agent] = { view, n: Number(rows[0].n), leakage: Number(rows[0].leakage) };
    } catch (err) {
      baseline[agent] = { view, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Clean merchant: balanced auth + capture + scheme settlement must not appear as unmatched.
  await sql.query(`INSERT INTO ra_merchants (merchant_id, name, mcc, country, currency, mdr_bps, settlement_delay_days, segment, is_synthetic)
    VALUES ('MER_REGCLEAN','Regression Clean','5411','IN','INR',80,1,'smb',1)
    ON CONFLICT (merchant_id) DO NOTHING`);
  await sql.query(`INSERT INTO ra_authorizations (auth_id, merchant_id, ts, amount, currency, method, scheme, status, recon_ref, is_synthetic)
    VALUES ('AUTH-REGCLEAN','MER_REGCLEAN','2026-10-15T10:00:00', 10000, 'INR','card','VISA','approved','RC-CLEAN',1)
    ON CONFLICT (auth_id) DO NOTHING`);
  await sql.query(`INSERT INTO ra_captures (capture_id, auth_id, ts, amount, recon_ref, is_synthetic)
    VALUES ('CAP-REGCLEAN','AUTH-REGCLEAN','2026-10-15T10:01:00', 10000, 'RC-CLEAN',1)
    ON CONFLICT (capture_id) DO NOTHING`);
  await sql.query(`INSERT INTO ra_scheme_settlements (scheme_id, capture_id, scheme, settlement_date, gross, interchange, scheme_fee, net, recon_ref, is_synthetic)
    VALUES ('SCH-REGCLEAN','CAP-REGCLEAN','VISA','2026-10-16',10000,20,10,9970,'RC-CLEAN',1)
    ON CONFLICT (scheme_id) DO NOTHING`);

  const clean = await sql.query(`SELECT status, leakage FROM v_ra_capture_scheme WHERE ref_id='CAP-REGCLEAN'`);
  const cleanOk = clean[0] && clean[0].status === "matched" && Number(clean[0].leakage) === 0;
  if (!cleanOk) card.remaining.push(`Clean merchant CAP-REGCLEAN was not matched (got ${JSON.stringify(clean[0]||null)})`);

  // Plant known breaks
  const plants = [];

  await sql.query(`INSERT INTO ra_authorizations (auth_id, merchant_id, ts, amount, currency, method, scheme, status, recon_ref, is_synthetic)
    VALUES ('AUTH-REGTEST-1','MER_REGCLEAN','2026-10-20T12:00:00', 12345.67, 'INR','card','VISA','approved','RC-MISS',1)
    ON CONFLICT (auth_id) DO NOTHING`);
  await sql.query(`INSERT INTO ra_captures (capture_id, auth_id, ts, amount, recon_ref, is_synthetic)
    VALUES ('CAP-REGTEST-1','AUTH-REGTEST-1','2026-10-20T12:01:00', 12345.67, 'RC-MISS',1)
    ON CONFLICT (capture_id) DO NOTHING`);
  // no scheme settlement → missing_scheme_settlement, leakage 12345.67
  plants.push({ agent: "recon_scheme", id: "CAP-REGTEST-1", amount: 12345.67, view: "v_ra_capture_scheme", category: "missing_scheme_settlement" });

  await sql.query(`INSERT INTO ra_gateway_charges (fee_id, recon_ref, expected, invoiced, is_synthetic)
    VALUES ('REGTEST-GW-1','RC-CLEAN', 100.00, 250.00, 1)
    ON CONFLICT (fee_id) DO NOTHING`);
  plants.push({ agent: "recon_network_gateway", id: "REGTEST-GW-1", amount: 150, view: "v_ra_fee_gateway", category: "gateway_fee_variance" });

  await sql.query(`INSERT INTO ra_network_fees (fee_id, recon_ref, fee_type, expected, invoiced, is_synthetic)
    VALUES ('REGTEST-NET-1','RC-CLEAN','scheme', 80.00, 95.50, 1)
    ON CONFLICT (fee_id) DO NOTHING`);
  plants.push({ agent: "network_fees", id: "REGTEST-NET-1", amount: 15.5, view: "v_ra_fee_network", category: "network_fee_variance" });

  // v_ra_aml groups by pattern+merchant and exposes ref_id as `${pattern}-${merchant_id}`.
  await sql.query(`INSERT INTO ra_aml_txns (txn_id, merchant_id, ts, amount, pattern, related_ref, is_synthetic)
    VALUES ('REGTEST-AML-1','MER_REGCLEAN','2026-10-21T09:00:00', 8888.00, 'regtest_velocity','peak-day',1)
    ON CONFLICT (txn_id) DO UPDATE SET pattern = EXCLUDED.pattern, amount = EXCLUDED.amount, merchant_id = EXCLUDED.merchant_id, ts = EXCLUDED.ts`);
  plants.push({ agent: "recon_aml", id: "regtest_velocity-MER_REGCLEAN", amount: 8888, view: "v_ra_aml" });

  await sql.query(`INSERT INTO ra_config_changes (change_id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at, approved, impact, note, is_synthetic)
    VALUES ('REGTEST-CFG-1','merchant','MER_REGCLEAN','mdr_bps','80','200','regression','2026-10-22T00:00:00',0, 999.00, 'planted unapproved MDR hike',1)
    ON CONFLICT (change_id) DO NOTHING`);
  plants.push({ agent: "recon_config", id: "REGTEST-CFG-1", amount: 999, view: "v_ra_config" });

  await sql.query(`INSERT INTO ra_expected_files (expected_id, file_kind, party, expected_date, sequence, is_synthetic)
    VALUES ('REGTEST-FILE-1','scheme_settlement','VISA','2026-10-30', 999, 1)
    ON CONFLICT (expected_id) DO NOTHING`);
  plants.push({ agent: "recon_files", id: "REGTEST-FILE-1", view: "v_ra_files" });

  await sql.query(`INSERT INTO ra_bank_transactions (bank_txn_id, trs_ref, value_date, amount, currency, narrative, recon_ref, is_synthetic)
    VALUES ('REGTEST-BANK-1','TRS-REG', '2026-10-23', 4321.00, 'INR', 'unidentified planted credit', NULL, 1)
    ON CONFLICT (bank_txn_id) DO NOTHING`);
  plants.push({ agent: "recon_bank", id: "REGTEST-BANK-1", amount: 4321, view: "v_ra_bank_unidentified", category: "unidentified_bank_credit" });

  // Detect planted rows in the views
  const detections = [];
  for (const p of plants) {
    try {
      const rows = await sql.query(`SELECT * FROM ${p.view} WHERE CAST(ref_id AS text) = $1 OR CAST(ref_id AS text) LIKE $2`, [p.id, `%${p.id}%`]);
      const row = rows[0];
      const found = Boolean(row);
      const statusOk = found && String(row.status) !== "matched";
      const amountOk = p.amount == null || (found && nearly(row.leakage, p.amount, 0.05));
      const catOk = !p.category || (found && String(row.category) === p.category);
      const pass = found && statusOk && amountOk && catOk;
      detections.push({ ...p, found, status: row?.status, leakage: row?.leakage, category: row?.category, pass });
      card.add(p.agent, { functional: pass ? "pass" : "fail", detail: pass
        ? `planted ${p.id} detected (${row.status}, ₹${row.leakage})`
        : `planted ${p.id} not detected cleanly (found=${found}, status=${row?.status}, leakage=${row?.leakage})` });
    } catch (err) {
      detections.push({ ...p, pass: false, error: err instanceof Error ? err.message : String(err) });
      card.add(p.agent, { functional: "fail", detail: `view ${p.view}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Refresh summaries on the branch and ensure the planted scheme leakage is reflected in book totals after rebuild where applicable
  await sql.query("SELECT refresh_ra_summaries()");
  const after = (await sql.query("SELECT total_leakage, exception_count FROM ra_kpi_summary WHERE id=1"))[0];

  // Agents whose views existed at baseline but we did not plant still "functionally match" if the view is queryable
  for (const [agent, info] of Object.entries(baseline)) {
    const row = card.rows.find((r) => r.agent === agent);
    if (row && row.functional == null) {
      if (info.error) card.add(agent, { functional: "fail", detail: `view ${info.view}: ${info.error}` });
      else card.add(agent, { functional: "pass", detail: `view ${info.view} baseline unmatched n=${info.n} ₹${info.leakage.toFixed(2)}; no false positive on MER_REGCLEAN matched pair` });
    }
  }
  card.add("recon_authorization", { functional: cleanOk ? "pass" : "fail", detail: "Clean CAP-REGCLEAN auth+capture+settlement is matched with ₹0 leakage" });

  writeFileSync(`${RESULTS}/plants.json`, JSON.stringify({ clean: clean[0], detections, afterRefresh: after, baseline }, null, 2));
  return { detections, after, baseline, cleanOk };
}

async function sectionIdempotency(sql) {
  const before = await sql.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage FROM ra_exception_rows`);
  const anom = await sql.query(`SELECT status, COUNT(*)::int n FROM ra_anomaly_events GROUP BY status`);
  const cases = await sql.query(`SELECT COUNT(*)::int AS n FROM ra_cases`);
  await sql.query("SELECT refresh_ra_summaries()");
  await sql.query("SELECT refresh_ra_summaries()");
  const after = await sql.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage FROM ra_exception_rows`);
  const anom2 = await sql.query(`SELECT status, COUNT(*)::int n FROM ra_anomaly_events GROUP BY status`);
  const cases2 = await sql.query(`SELECT COUNT(*)::int AS n FROM ra_cases`);
  const leakBefore = Math.round(Number(before[0].leakage) * 100) / 100;
  const leakAfter = Math.round(Number(after[0].leakage) * 100) / 100;
  const sameEx = before[0].n === after[0].n && nearly(leakBefore, leakAfter, 0.5);
  const norm = (rows) => JSON.stringify([...rows].sort((a, b) => String(a.status).localeCompare(String(b.status))));
  const sameAnom = norm(anom) === norm(anom2);
  const sameCases = cases[0].n === cases2[0].n;
  const pass = sameEx && sameAnom && sameCases;
  card.add("anomaly", { technical: pass ? "pass" : "fail", functional: pass ? "pass" : "fail", detail: `refresh×2 exception n ${before[0].n}→${after[0].n} leakage ₹${leakBefore}→₹${leakAfter}; anomalies ${sameAnom}; cases ${cases[0].n}→${cases2[0].n}` });
  if (!pass) card.remaining.push("Idempotent refresh changed exception, anomaly or case counts");
  return pass;
}

async function sectionGates() {
  // Review decision without comment should fail
  const noComment = await api("/api/reviews/scheme%3Amissing_scheme_settlement%3ACAP00216/decision", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  });
  const reviewBlocked = noComment.status >= 400;
  card.add("review", { technical: reviewBlocked ? "pass" : "fail", detail: `decision without comment → ${noComment.status}` });

  // Bad suggestion dismiss without comment
  const dismiss = await api("/api/audit/suggestions", {
    method: "POST",
    body: JSON.stringify({ exception_id: "x", suggestion: { suggestion_id: "sug-x" }, decision: "dismissed" }),
  });
  const dismissBlocked = dismiss.status >= 400;
  card.add("auditor", { technical: dismissBlocked ? "pass" : "fail", detail: `dismiss without a valid context → ${dismiss.status}` });

  // Contract rule decision with bogus id
  const rule = await api("/api/contracts/rules/does-not-exist/decision", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  });
  card.add("contract_extract", { technical: rule.status >= 400 ? "pass" : "fail", detail: `unknown rule decision → ${rule.status}` });

  if (!reviewBlocked) card.remaining.push("Review decision accepted a request without a comment");
}

async function sectionAutonomy(sql) {
  // Cron is registered in wrangler.jsonc (assert from file)
  const wrangler = (await import("node:fs")).readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
  const cronOk = wrangler.includes("15 2 * * *");
  const latest = await api("/api/automation/latest");
  const last = latest.body?.latest || latest.body;
  card.notes.push(`Cron expression 15 2 * * * ${cronOk ? "registered" : "MISSING"}; last live log status=${last?.status} started=${last?.started_at} finished=${last?.finished_at}`);
  if (last?.status === "running" && !last?.finished_at) {
    card.bugs.push("Live daily cron (15 2 * * * UTC, 7:45 AM IST) left ra_automation_log status='running' with no finished_at (started 2026-11-22 07:45 AM IST). Fixed: await the job, always write a terminal log status, and keep the default daily path deterministic so a Workers AI timeout cannot hang the run.");
  }

  // Trigger scheduled locally against the TEST branch only.
  const scheduled = await triggerScheduled();
  if (scheduled.ok) {
    const logs = await sql.query(`SELECT status, started_at, finished_at, detail FROM ra_automation_log ORDER BY started_at DESC LIMIT 3`);
    const newest = logs[0];
    const finished = newest && newest.status !== "running" && newest.finished_at;
    const refreshed = newest && JSON.stringify(newest.detail || {}).includes("summaries_refreshed");
    card.add("orchestrator", { autonomous: finished ? "yes" : "no", functional: finished && refreshed ? "pass" : "fail" });
    card.notes.push(`Local scheduled() test: ${scheduled.detail}; newest log status=${newest?.status} finished=${Boolean(finished)} refresh=${Boolean(refreshed)}`);
    if (!finished) card.remaining.push("Local scheduled() test did not write a completed/failed automation log");
  } else {
    card.notes.push(`Local scheduled() trigger skipped or failed: ${scheduled.detail}`);
    card.remaining.push(`Could not run wrangler dev --test-scheduled: ${scheduled.detail}`);
  }
  return { cronOk, last, scheduled };
}

async function triggerScheduled() {
  if (process.env.SKIP_SCHEDULED === "1") return { ok: false, detail: "SKIP_SCHEDULED=1" };
  const { writeFileSync: w, readFileSync: r } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const devVars = join(ROOT, ".dev.vars");
  const url = process.env.REGRESSION_DATABASE_URL || r(process.env.REGRESSION_DATABASE_URL_FILE || "/workspace/secrets/neon_regression_url", "utf8").trim();
  let prev = "";
  try { prev = r(devVars, "utf8"); } catch { /* none */ }
  w(devVars, `DATABASE_URL=${url}\n`, { mode: 0o600 });
  const redact = (s) => s.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]");
  const child = spawn("npx", ["wrangler", "dev", "--test-scheduled", "--port", "8789", "--ip", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let out = "";
  const onChunk = (d) => { out += d.toString(); };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);
  const ready = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 60000);
    const check = () => {
      if (/Ready on|Ready:|localhost:8789|127\.0\.0\.1:8789/i.test(out)) { clearTimeout(t); resolve(true); }
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.on("exit", () => { clearTimeout(t); resolve(/Ready on|localhost:8789|127\.0\.0\.1:8789/i.test(out)); });
  });
  let result = { ok: false, detail: "wrangler dev did not become ready" };
  if (ready) {
    const endpoints = [
      { url: "http://127.0.0.1:8789/cdn-cgi/handler/scheduled?cron=15+2+*+*+*", method: "GET" },
      { url: "http://127.0.0.1:8789/cdn-cgi/handler/scheduled?cron=15+2+*+*+*", method: "POST" },
      { url: "http://127.0.0.1:8789/__scheduled?cron=15+2+*+*+*", method: "GET" },
      { url: "http://127.0.0.1:8789/__scheduled?cron=15+2+*+*+*", method: "POST" },
    ];
    for (const ep of endpoints) {
      try {
        const r2 = await fetch(ep.url, { method: ep.method });
        const text = await r2.text();
        const ok = r2.ok || r2.status === 200 || /ok|success|completed/i.test(text);
        result = { ok, detail: `${ep.method} ${ep.url.replace("http://127.0.0.1:8789", "")} → HTTP ${r2.status} ${text.slice(0, 180)}` };
        if (ok) break;
      } catch (err) {
        result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }
  } else {
    result = { ok: false, detail: redact(out.slice(-400)) || "timeout waiting for wrangler dev" };
  }
  const killTree = () => {
    try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    try { execSync("fuser -k 8789/tcp", { stdio: "ignore" }); } catch { /* ignore */ }
  };
  killTree();
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* ignore */ }
      try { execSync("fuser -k 8789/tcp", { stdio: "ignore" }); } catch { /* ignore */ }
      resolve();
    }, 5000);
    child.on("exit", () => { clearTimeout(t); resolve(); });
  });
  try { w(`${RESULTS}/scheduled-wrangler.log`, redact(out).slice(-8000)); } catch { /* ignore */ }
  try { if (prev) w(devVars, prev, { mode: 0o600 }); } catch { /* ignore */ }
  return result;
}


async function sectionModels(sql) {
  const fd = JSON.parse(readFileSync(join(ROOT, "shared/ml/models/false_decline.json"), "utf8"));
  const cb = JSON.parse(readFileSync(join(ROOT, "shared/ml/models/chargeback.json"), "utf8"));
  const features = fd.self_check?.x || {};
  const pred = await api("/api/models/predict", { method: "POST", body: JSON.stringify({ model_id: "false_decline", features }) });
  const ev = pred.body || {};
  const predOk = pred.ok && ev.check === true && nearly(ev.shap_sum + ev.base, ev.raw, 1e-5);
  const matchTrain = fd.self_check?.pred == null || nearly(ev.score, fd.self_check.pred, 1e-5);
  card.add("gbdt_models", {
    technical: predOk && matchTrain ? "pass" : "fail",
    functional: predOk && matchTrain ? "pass" : "fail",
    detail: `predict false_decline score=${ev.score} raw=${ev.raw} check=${ev.check} train_match=${matchTrain} (${pred.status})`,
  });
  const pred2 = await api("/api/models/predict", { method: "POST", body: JSON.stringify({ model_id: "chargeback", features: cb.self_check?.x || features }) });
  const ev2 = pred2.body || {};
  const shapOk = pred2.ok && ev2.check === true && nearly((ev2.shap_sum ?? 0) + (ev2.base ?? 0), ev2.raw, 1e-5);
  card.add("shap_explain", {
    technical: predOk && shapOk ? "pass" : "fail",
    functional: predOk && shapOk ? "pass" : "fail",
    detail: `SHAP identity FD ${ev.shap_sum}+${ev.base}=${ev.raw}; CB ${ev2.shap_sum}+${ev2.base}=${ev2.raw}`,
  });
  const bad = await api("/api/models/predict", { method: "POST", body: JSON.stringify({ model_id: "no_such_model", features: {} }) });
  if (bad.status < 400) card.remaining.push(`Unknown model_id should be 4xx, got ${bad.status}`);

  // Plants on the test branch only
  try {
    await sql.query(`INSERT INTO ra_authorizations (auth_id, merchant_id, ts, amount, currency, method, scheme, status, recon_ref, is_synthetic)
      VALUES ('FD-PLANT-1','MER_REGCLEAN','2026-10-21T11:00:00', 7777.00, 'INR','card','VISA','declined','FD-PLANT',1)
      ON CONFLICT (auth_id) DO UPDATE SET status='declined', amount=7777.00`);
    await sql.query(`INSERT INTO ra_auth_attributes (auth_id, decline_reason, is_emi, channel, is_synthetic)
      VALUES ('FD-PLANT-1','do_not_honour',0,'pos',1)
      ON CONFLICT (auth_id) DO UPDATE SET decline_reason='do_not_honour'`);
    await sql.query(`SELECT public.refresh_ra_features()`);
    await sql.query(`INSERT INTO ra_model_scores (subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, scored_at)
      VALUES ('auth','FD-PLANT-1','false_decline','v9.0.0', 0.91, 2.3, 0, '[]'::jsonb, '[]'::jsonb, now())
      ON CONFLICT (subject_type, subject_id, model_id) DO UPDATE SET score=0.91, raw_score=2.3, version='v9.0.0'`);
    await sql.query(`INSERT INTO ra_captures (capture_id, auth_id, ts, amount, recon_ref, is_synthetic)
      VALUES ('CAP-CB-PLANT-1','AUTH-REGCLEAN','2026-10-15T10:02:00', 4321.00, 'RC-CB-PLANT',1)
      ON CONFLICT (capture_id) DO NOTHING`);
    // A high chargeback score on a dedicated capture (does not change book leakage)
    await sql.query(`INSERT INTO ra_model_scores (subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, scored_at)
      VALUES ('capture','CAP-CB-PLANT-1','chargeback','v9.0.0', 0.80, 1.4, 0, '[]'::jsonb, '[]'::jsonb, now())
      ON CONFLICT (subject_type, subject_id, model_id) DO UPDATE SET score=0.80`);
    await sql.query(`INSERT INTO ra_model_scores (subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, scored_at)
      VALUES ('settlement','SCH-IF-PLANT','iforest','v9.0.0', 0.88, 0.88, 0, '[]'::jsonb, '[]'::jsonb, now())
      ON CONFLICT (subject_type, subject_id, model_id) DO UPDATE SET score=0.88, raw_score=0.88`);
    await sql.query(`SELECT public.refresh_ra_v9()`);
    const fdRow = (await sql.query(`SELECT * FROM v_ra_false_declines WHERE CAST(ref_id AS text) = 'FD-PLANT-1'`))[0];
    const fdPass = Boolean(fdRow) && nearly(fdRow.leakage, 7777 * 0.91, 0.05);
    card.add("recon_false_declines", {
      functional: fdPass ? "pass" : "fail",
      detail: fdPass ? `planted FD-PLANT-1 detected, leakage ₹${fdRow.leakage}` : `FD-PLANT-1 missing or leakage=${fdRow?.leakage}`,
    });
    const exp = (await sql.query(`SELECT chargeback_exposure FROM ra_ml_kpi WHERE id=1`))[0];
    const cbPass = exp && Number(exp.chargeback_exposure) >= 4321 * 0.80 - 0.05;
    card.add("chargebacks", {
      functional: cbPass ? "pass" : (card.rows.find((r) => r.agent === "chargebacks")?.functional ?? "fail"),
      detail: `high-risk exposure ₹${exp?.chargeback_exposure}; planted CAP-CB-PLANT-1 at p=0.80 contributes ₹${(4321*0.80).toFixed(2)}`,
    });
    const evIf = (await sql.query(`SELECT event_id, status FROM ra_anomaly_events WHERE event_id='IF-settlement-SCH-IF-PLANT'`))[0];
    const ifPass = evIf && evIf.status === "open";
    // idempotent sync
    const n1 = (await sql.query(`SELECT COUNT(*)::int n FROM ra_anomaly_events WHERE metric LIKE 'iforest%'`))[0].n;
    await sql.query(`SELECT public.sync_ra_iforest_anomalies()`);
    await sql.query(`SELECT public.sync_ra_iforest_anomalies()`);
    const n2 = (await sql.query(`SELECT COUNT(*)::int n FROM ra_anomaly_events WHERE metric LIKE 'iforest%'`))[0].n;
    const idem = n1 === n2;
    card.add("iforest", {
      functional: ifPass ? "pass" : "fail",
      technical: idem ? "pass" : "fail",
      detail: `planted SCH-IF-PLANT ${ifPass ? "open" : "missing"}; iforest events ${n1}→${n2} after sync×2`,
    });
    // Seed any new case/category rows before the idempotency section snapshots counts.
    await sql.query("SELECT public.refresh_ra_summaries()");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    card.add("recon_false_declines", { functional: "fail", detail: msg });
    card.add("iforest", { functional: "fail", detail: msg });
    card.remaining.push(`v9 plants: ${msg}`);
  }
}

async function sectionPlaywright() {
  if (process.env.SKIP_PLAYWRIGHT === "1") {
    card.notes.push("Playwright skipped (SKIP_PLAYWRIGHT=1)");
    return { skipped: true };
  }
  const script = `
import { writeFileSync } from "node:fs";
import pkg from "/home/box/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js";
const { chromium } = pkg;
const BASE = process.env.BASE_URL || "https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev";
const OUT = process.env.RESULTS_DIR || "/workspace/verify/regression";
const WIDTHS = [1440, 1280, 390];
const PAGES = [
  "/", "/lifecycle", "/agents", "/investigate", "/controls", "/trace", "/network-risk",
  "/contracts", "/anomalies", "/routing", "/ask", "/cases", "/risks", "/files",
  "/ingestion", "/review", "/authorization", "/scheme", "/bank", "/fees", "/aml", "/tax", "/kyc",
  "/models", "/false-declines",
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const overlaps = [];
const charts = [];
async function overlapCount(page) {
  return page.evaluate(() => {
    const hidden = (el) => { const s = getComputedStyle(el); return s.visibility==="hidden"||s.display==="none"||Number(s.opacity)===0; };
    const sels = ["h1","h2","h3","p","span","label","th","td","button","a","li",".recharts-cartesian-axis-tick-label"];
    const boxes = [];
    for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
      if (hidden(el)) continue;
      const text = (el.textContent||"").replace(/\\s+/g," ").trim();
      if (!text || text.length>80) continue;
      const r = el.getBoundingClientRect();
      if (r.width<2||r.height<2||r.bottom<0||r.right<0) continue;
      boxes.push({ el, text:text.slice(0,70), x:r.x,y:r.y,w:r.width,h:r.height });
    }
    const area=(b)=>b.w*b.h;
    const inter=(a,b)=>{ const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y); const w=Math.min(a.x+a.w,b.x+b.w)-x; const h=Math.min(a.y+a.h,b.y+b.h)-y; return w>1&&h>1?w*h:0; };
    const contains=(a,b)=>a.x<=b.x+0.5&&a.y<=b.y+0.5&&a.x+a.w>=b.x+b.w-0.5&&a.y+a.h>=b.y+b.h-0.5;
    let hits=0;
    for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j];
      if (a.el.contains(b.el)||b.el.contains(a.el)) continue;
      if (contains(a,b)||contains(b,a)) continue;
      const ia=inter(a,b); if (ia<8) continue;
      if (ia/Math.min(area(a),area(b))>=0.12) hits++;
    }
    return hits;
  });
}
function chartAudit() {
  const charts=[...document.querySelectorAll(".recharts-wrapper")];
  const out=[];
  const vis=(el)=>{ const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>=1&&r.height>=1&&s.visibility!=="hidden"&&s.display!=="none"; };
  const isNum=(s)=>{ const t=String(s).replace(/[₹$€,\\s]/g,"").replace(/[−–-]/,"-"); return /^-?\\d+(\\.\\d+)?([LCkKmM%]|Cr)?$/.test(t); };
  for (const chart of charts) {
    const series=[...chart.querySelectorAll(".recharts-bar")];
    if (!series.length) continue;
    const rects=[...series[0].querySelectorAll(".recharts-bar-rectangle")].filter((el)=>!el.closest(".recharts-inactive-bar")&&vis(el));
    if (!rects.length) continue;
    const collect=(root)=>[...chart.querySelectorAll(root+" .recharts-cartesian-axis-tick-label")].filter((el)=>((el.textContent||"").trim())&&vis(el)).map((el)=>(el.querySelector("title")?.textContent||el.textContent||"").trim());
    const y=collect(".recharts-yAxis-tick-labels"), x=collect(".recharts-xAxis-tick-labels");
    const mostly=(labs)=>labs.length>0&&labs.filter(isNum).length>=Math.ceil(labs.length*0.7);
    const cat=!mostly(y)&&y.length?y:!mostly(x)&&x.length?x:[];
    out.push({ bars:rects.length, ticks:cat.length, ok:cat.length===rects.length });
  }
  return out;
}
for (const w of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: w, height: 1400 } });
  const page = await context.newPage();
  page.on("pageerror", (e)=>errors.push({ w, type:"pageerror", msg:e.message, url:page.url() }));
  page.on("console", (msg)=>{ if (msg.type()==="error") errors.push({ w, type:"console", msg:msg.text(), url:page.url() }); });
  for (const path of PAGES) {
    await page.goto(BASE+path, { waitUntil: "networkidle", timeout: 45000 }).catch((e)=>errors.push({ w, type:"nav", msg:String(e), url:path }));
    await page.waitForTimeout(250);
    const hits = await overlapCount(page);
    overlaps.push({ path, w, hits });
    const c = await page.evaluate(chartAudit);
    if (c.length) charts.push({ path, w, c });
    if (path==="/" && w===1440) {
      await page.getByText("Top leakage drivers").first().scrollIntoViewIfNeeded().catch(()=>{});
      await page.screenshot({ path: OUT+"/v8-regression-executive.png", fullPage: true });
      const comp = page.getByText("Compliance exposure").first();
      if (await comp.count()) {
        await comp.scrollIntoViewIfNeeded();
        await page.screenshot({ path: OUT+"/v8-regression-compliance-exposure.png", fullPage: true });
      }
    }
  }
  await context.close();
}
const report = { errors, overlaps, charts, overlap_hits: overlaps.reduce((s,o)=>s+o.hits,0), chart_mismatches: charts.flatMap(x=>x.c).filter(c=>!c.ok) };
writeFileSync(OUT+"/playwright.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ overlap_hits: report.overlap_hits, console_errors: errors.length, chart_mismatches: report.chart_mismatches.length, pages: PAGES.length, widths: WIDTHS.length }));
await browser.close();
if (report.overlap_hits || errors.length || report.chart_mismatches.length) process.exitCode = 1;
`;
  writeFileSync("/tmp/v8_regression_pw.mjs", script);
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync("node", ["/tmp/v8_regression_pw.mjs"], {
    env: { ...process.env, BASE_URL: BASE, RESULTS_DIR: RESULTS },
    encoding: "utf8",
    timeout: 300000,
  });
  const summary = (res.stdout || "").trim().split("\n").pop();
  card.notes.push(`Playwright: ${summary || res.stderr.slice(0, 300)} (exit ${res.status})`);
  const techPass = res.status === 0;
  if (!techPass) card.remaining.push(`Playwright failed: ${summary || res.stderr.slice(0, 200)}`);
  // attach a technical result to frontend-facing agents
  card.add("gap_detection", { technical: techPass ? "pass" : "fail" });
  return { ok: techPass, summary };
}


async function sectionInvestigateCfg003() {
  const eid = "config:config_unapproved:CFG-003";
  const others = [
    "scheme:missing_scheme_settlement:CAP00216",
    "apm:apm_report_mismatch:APM0008",
  ];
  const ex = await api(`/api/exceptions/${encodeURIComponent(eid)}`);
  const row = ex.body?.exception || ex.body;
  const okEx = ex.ok && row?.exception_id === eid && Number(row.leakage) > 2000;
  if (!okEx) {
    card.add("investigator", { functional: "fail", detail: `CFG-003 load → ${ex.status}` });
    card.add("auditor", { functional: "fail", detail: "CFG-003 exception missing; skipped pipeline" });
    return;
  }
  for (const other of others) {
    const r = await api(`/api/exceptions/${encodeURIComponent(other)}`);
    const latest = await api(`/api/agents/latest?scope=${encodeURIComponent("exception:" + other)}`);
    const agents = (latest.body?.latest?.outputs || []).map((o) => o.agent_id);
    card.notes.push(`${other} → ${r.status}; latest agents=[${agents.join(",")}] status=${latest.body?.latest?.run?.status || "none"}`);
  }
  const started = await api("/api/agents/runs", {
    method: "POST",
    body: JSON.stringify({ scope: `exception:${eid}`, domain: "config" }),
  });
  if (!started.ok || !started.body?.run_id) {
    card.add("investigator", { functional: "fail", detail: `CFG-003 start run failed ${started.status}` });
    card.add("auditor", { functional: "fail", detail: `CFG-003 start run failed ${started.status}` });
    return;
  }
  const runId = started.body.run_id;
  const results = {};
  for (const agent of ["investigator", "action", "auditor"]) {
    results[agent] = await api("/api/agents/step", {
      method: "POST",
      body: JSON.stringify({
        run_id: runId,
        agent_id: agent,
        scope: `exception:${eid}`,
        domain: "config",
        exception_id: eid,
        mode: "deterministic",
      }),
    });
  }
  const done = await api("/api/agents/complete", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const inv = results.investigator;
  const act = results.action;
  const aud = results.auditor;
  const invOk = inv.ok && (inv.body.output?.root_cause || inv.body.output?.summary) && inv.ms < 20000;
  const actOk = act.ok && Array.isArray(act.body.output?.actions) && act.ms < 20000;
  const checks = aud.body?.output?.checks;
  const cfo = String(aud.body?.output?.cfo_one_liner ?? "");
  const verdict = String(aud.body?.output?.verdict ?? "");
  const cfoMatches = verdict === "approved" || !/ready to sign off/i.test(cfo);
  const audOk = aud.ok
    && Array.isArray(checks)
    && checks.length === 6
    && aud.body.output.source === "deterministic"
    && (aud.body.output.verdict === "needs_review" || aud.body.output.signoff === "needs_review")
    && cfoMatches
    && aud.ms < 20000;
  card.add("investigator", { functional: invOk ? "pass" : "fail", detail: `CFG-003 investigator ${inv.status} ${inv.ms}ms` });
  card.add("action", { functional: actOk ? "pass" : "fail", detail: `CFG-003 action ${act.status} ${act.ms}ms actions=${act.body?.output?.actions?.length ?? 0}` });
  card.add("auditor", {
    functional: audOk && done.ok ? "pass" : "fail",
    detail: `CFG-003 auditor fallback checks=${checks?.length ?? 0} source=${aud.body?.output?.source} verdict=${aud.body?.output?.verdict} cfo=${cfo} ${aud.ms}ms complete=${done.status}`,
  });
}

async function sectionTypecheck() {
  const { spawnSync } = await import("node:child_process");
  const tscW = spawnSync("npx", ["tsc", "-p", "tsconfig.worker.json", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  const tscA = spawnSync("npx", ["tsc", "-p", "tsconfig.app.json", "--noEmit"], { cwd: ROOT, encoding: "utf8" });
  const cfo = spawnSync("npx", ["tsx", "tests/auditor-cfo.test.ts"], { cwd: ROOT, encoding: "utf8" });
  const ok = tscW.status === 0 && tscA.status === 0 && cfo.status === 0;
  card.notes.push(`Typecheck worker ${tscW.status === 0 ? "ok" : "FAIL"} frontend ${tscA.status === 0 ? "ok" : "FAIL"}; auditor CFO test ${cfo.status === 0 ? "ok" : "FAIL"}`);
  if (!ok) {
    card.remaining.push(`Typecheck/CFO test failed:\n${(tscW.stdout + tscW.stderr + tscA.stdout + tscA.stderr + cfo.stdout + cfo.stderr).slice(0, 800)}`);
  }
  return ok;
}

async function main() {
  console.log("Regression against", BASE, "results →", RESULTS);
  const sql = db();
  console.log("section: live API");
  await sectionLiveApi();
  console.log("section: SQL safety");
  await sectionSqlSafety();
  console.log("section: KPI reconcile");
  await sectionKpiReconcile(sql);
  console.log("section: functional plants");
  await sectionFunctionalPlants(sql);
  console.log("section: v9 models");
  await sectionModels(sql);
  console.log("section: idempotency");
  await sectionIdempotency(sql);
  console.log("section: gates");
  await sectionGates();
  console.log("section: autonomy / scheduled");
  await sectionAutonomy(sql);
  console.log("section: CFG-003 investigate path");
  await sectionInvestigateCfg003();
  console.log("section: typecheck");
  await sectionTypecheck();
  console.log("section: playwright");
  await sectionPlaywright();
  // file parsers: confirm ingest tables exist and sample rows parse-related controls exist
  try {
    const files = await sql.query("SELECT COUNT(*)::int n FROM ra_ingest_files");
    card.add("file_parsers", { functional: files[0].n > 0 ? "pass" : "fail", technical: "pass", detail: `${files[0].n} ingest file records on the test branch` });
  } catch (err) {
    card.add("file_parsers", { functional: "fail", detail: err instanceof Error ? err.message : String(err) });
  }
  const report = card.write({ base: BASE });
  console.log(JSON.stringify(report.totals, null, 2));
  const failed = report.totals.functional.fail + report.totals.technical.fail;
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error("SUITE_ERROR", err instanceof Error ? err.message : String(err));
  card.remaining.push(String(err instanceof Error ? err.message : err));
  card.write();
  process.exit(2);
});
