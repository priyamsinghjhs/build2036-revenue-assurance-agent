import { Parser } from "node-sql-parser";
import type { AppDb } from "./pg";
import type { Env } from "./types";

/** Allow-listed canonical columns an expected_fee expression may reference. */
export const CANONICAL_COLUMNS = [
  "txn_id",
  "payment_rail",
  "card_segment",
  "txn_amount",
  "actual_fee",
  "merchant_id",
  "scheme",
  "method",
  "mcc",
  "currency",
  "settlement_amount",
  "recon_amount",
  "de4_amount",
  "de5_amount",
  "is_rupay_credit",
  "is_ppi",
  "p2m_flag",
  "ird",
  "irf",
  "response_code",
  "txn_status",
  "tcr5_qualification",
] as const;

const ALLOWED_FUNCS = new Set([
  "CAST",
  "LEAST",
  "GREATEST",
  "COALESCE",
  "NULLIF",
  "ABS",
  "LOWER",
  "UPPER",
  "TRIM",
  "ROUND",
  "NUMERIC",
  "DECIMAL",
]);

export type StructuredRule = {
  rule_id?: string;
  rule_name?: string;
  fee_type?: string;
  rate?: number | null;
  unit?: string | null;
  threshold?: number | null;
  cap?: number | null;
  flat_fee?: number | null;
  previous_rate?: number | null;
};

export type RuleTest = {
  test_id: string;
  name: string;
  inputs: Record<string, unknown>;
  expected: string;
  actual?: string | null;
  passed?: boolean | null;
  note?: string;
};

export type Validation = { ok: true; sql: string } | { ok: false; error: string };

function rateFactor(rate: number, unit: string | null | undefined): number {
  if (unit === "pct") return rate / 100;
  if (unit === "bps" || !unit) return rate / 10000;
  return rate;
}

function numLit(n: number, scale = 8): string {
  return `CAST(${n.toFixed(scale)} AS NUMERIC(18,${scale}))`;
}

function money(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Deterministic CASE compiler from structured rule parameters. */
export function compileExpectedFeeExpr(rule: StructuredRule): string {
  const unit = rule.unit ?? "bps";
  const rate = Number(rule.rate ?? 0);
  const factor = rateFactor(rate, unit);
  const threshold = rule.threshold == null ? null : Number(rule.threshold);
  const cap = rule.cap == null ? null : Number(rule.cap);
  const flat = rule.flat_fee == null ? null : Number(rule.flat_fee);
  const fallback = rule.previous_rate == null ? null : Number(rule.previous_rate);
  const fee = `CAST(txn_amount * ${numLit(factor)} AS NUMERIC(18,4))`;
  const capped = cap != null ? `LEAST(${fee}, ${numLit(cap, 4)})` : fee;
  const kind = rule.fee_type ?? "";

  if (kind === "settlement_sla") return "CAST(0 AS NUMERIC(18,4))";
  if (kind === "merchant_rebate") {
    if (threshold != null) {
      return `CASE WHEN txn_amount > ${numLit(threshold, 4)} THEN ${fee} ELSE CAST(0 AS NUMERIC(18,4)) END`;
    }
    return fee;
  }
  if (kind === "merchant_mdr_tier" || kind === "partner_share_tier") {
    const fb = fallback != null ? rateFactor(fallback, unit) : factor;
    const high = fee;
    const low = `CAST(txn_amount * ${numLit(fb)} AS NUMERIC(18,4))`;
    if (threshold != null) {
      return `CASE WHEN txn_amount >= ${numLit(threshold, 4)} THEN ${high} ELSE ${low} END`;
    }
    return high;
  }
  if (kind === "commercial_credit_mdr" || (cap != null && flat != null && threshold != null)) {
    const t = threshold ?? 0;
    return (
      "CASE " +
      "WHEN payment_rail = 'UPI' THEN CAST(0 AS NUMERIC(18,4)) " +
      `WHEN payment_rail = 'CARD' AND card_segment = 'COMMERCIAL_CREDIT' AND txn_amount > ${numLit(t, 4)} THEN ${capped} ` +
      `WHEN payment_rail = 'CARD' AND card_segment = 'COMMERCIAL_CREDIT' AND txn_amount <= ${numLit(t, 4)} THEN ${numLit(flat ?? 0, 4)} ` +
      "ELSE CAST(0 AS NUMERIC(18,4)) END"
    );
  }
  const zeroUpi =
    "WHEN payment_rail = 'UPI' AND COALESCE(is_rupay_credit, FALSE) = FALSE THEN CAST(0 AS NUMERIC(18,4))";
  return `CASE ${zeroUpi} ELSE ${capped} END`;
}

export function validateFeeExpression(expr: string): Validation {
  const trimmed = expr.trim().replace(/;+\s*$/, "");
  if (!trimmed) return { ok: false, error: "sql_expression is empty" };
  if (trimmed.includes(";")) return { ok: false, error: "Only a single expression is allowed" };
  if (/--|\/\*|\*\//.test(trimmed)) return { ok: false, error: "Comments are not allowed in the expression" };
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|execute|vacuum|refresh|attach|into|select|from|join|union|except|intersect|window|with|returning)\b/i.test(trimmed)) {
    return { ok: false, error: "Expression must be CASE/arithmetic only — no statements or subqueries" };
  }
  const wrapped = `SELECT (${trimmed}) AS expected_fee FROM canonical_settlement`;
  const parser = new Parser();
  let ast: unknown;
  try {
    ast = parser.astify(wrapped, { database: "postgresql" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SQL parser rejected the expression: ${msg.slice(0, 240)}` };
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) return { ok: false, error: "Only one expression is allowed" };
  const stmt = statements[0] as Record<string, unknown>;
  if (String(stmt.type).toLowerCase() !== "select") {
    return { ok: false, error: "Expression must parse as a scalar SELECT" };
  }
  if (stmt.with || stmt.set_op || stmt.union) {
    return { ok: false, error: "WITH / UNION are not allowed" };
  }
  const cols: string[] = [];
  const funcs: string[] = [];
  const types = new Set<string>();
  walk(stmt, cols, funcs, types);
  for (const t of types) {
    if (["insert", "update", "delete", "create", "drop", "alter"].includes(t)) {
      return { ok: false, error: `Mutating AST node '${t}' is not allowed` };
    }
  }
  for (const c of cols) {
    if (c === "expected_fee" || c === "canonical_settlement") continue;
    if (!(CANONICAL_COLUMNS as readonly string[]).includes(c)) {
      return { ok: false, error: `Column '${c}' is not in the allow-listed canonical set` };
    }
  }
  for (const f of funcs) {
    if (f && !ALLOWED_FUNCS.has(f.toUpperCase())) {
      return { ok: false, error: `Function '${f}' is not allow-listed` };
    }
  }
  return { ok: true, sql: trimmed };
}

function walk(node: unknown, cols: string[], funcs: string[], types: Set<string>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, cols, funcs, types);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o.type === "string") types.add(String(o.type).toLowerCase());
  const typ = String(o.type ?? "").toLowerCase();
  if (typ === "column_ref") {
    const col = o.column;
    let name = "";
    if (typeof col === "string") name = col;
    else if (col && typeof col === "object" && "expr" in (col as object)) {
      name = String((col as { expr?: { value?: unknown } }).expr?.value ?? "");
    } else if (typeof o.column === "number") name = String(o.column);
    if (name && name !== "*") cols.push(name);
  }
  if (typ === "function" || typ === "aggr_func" || typ === "cast") {
    const nm = functionName(o);
    if (nm) funcs.push(nm);
  }
  if (typeof o.dataType === "string") {
    const dt = o.dataType.toUpperCase();
    if (!["NUMERIC", "DECIMAL", "INT", "INTEGER", "BIGINT", "SMALLINT", "TEXT", "VARCHAR", "BOOL", "BOOLEAN"].includes(dt)) {
      funcs.push(dt);
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === "type") continue;
    walk(v, cols, funcs, types);
  }
}

function functionName(o: Record<string, unknown>): string {
  const n = o.name;
  if (typeof n === "string") return n;
  if (n && typeof n === "object") {
    const rec = n as Record<string, unknown>;
    if (typeof rec.name === "string") return rec.name;
    if (Array.isArray(rec.name)) {
      const last = rec.name[rec.name.length - 1] as { value?: string } | string;
      return typeof last === "string" ? last : String(last?.value ?? "");
    }
    if (typeof rec.value === "string") return rec.value;
  }
  return "";
}

/** Synthetic edge-case tests derived only from structured params, not from the SQL text. */
export function generateRuleTests(rule: StructuredRule): RuleTest[] {
  const unit = rule.unit ?? "bps";
  const rate = Number(rule.rate ?? 0);
  const factor = rateFactor(rate, unit);
  const threshold = rule.threshold == null ? null : Number(rule.threshold);
  const cap = rule.cap == null ? null : Number(rule.cap);
  const flat = rule.flat_fee == null ? null : Number(rule.flat_fee);
  const fallback = rule.previous_rate == null ? null : Number(rule.previous_rate);
  const kind = rule.fee_type ?? "";
  const prefix = rule.rule_id ?? "RULE";
  const tests: RuleTest[] = [];
  const applyCap = (raw: number) => (cap != null && raw > cap ? cap : raw);
  const add = (id: string, name: string, inputs: Record<string, unknown>, expected: number, note: string) => {
    tests.push({
      test_id: `${prefix}:${id}`,
      name,
      inputs: {
        payment_rail: "CARD",
        card_segment: "CONSUMER_DEBIT",
        currency: "INR",
        is_rupay_credit: false,
        is_ppi: false,
        ...inputs,
      },
      expected: money(expected).toFixed(4),
      note,
    });
  };

  add("zero_amount", "Zero amount", { txn_amount: 0, payment_rail: "CARD", card_segment: "COMMERCIAL_CREDIT" }, 0, "Zero transaction amount");
  add("upi_zero_mdr", "Zero-MDR UPI rail", { txn_amount: 12000, payment_rail: "UPI", card_segment: "NA", is_rupay_credit: false }, 0, "Illustrative zero-MDR UPI (standard bank-account P2M, not RuPay Credit)");

  if (kind === "commercial_credit_mdr" || (cap != null && flat != null && threshold != null)) {
    const t = threshold ?? 10000;
    // Override zero-amount: flat fee applies at 0 if amount <= threshold
    tests[0].expected = money(flat ?? 0).toFixed(4);
    tests[0].note = "Zero amount is at or below the threshold, so the flat fee applies";
    add("exactly_threshold", `Exactly ${t.toLocaleString("en-IN")}`, { txn_amount: t, payment_rail: "CARD", card_segment: "COMMERCIAL_CREDIT" }, flat ?? 0, "Boundary: amount equals the threshold (not strictly greater)");
    add("just_above", "Just above the threshold", { txn_amount: money(t + 0.01), payment_rail: "CARD", card_segment: "COMMERCIAL_CREDIT" }, applyCap((t + 0.01) * factor), "Boundary: first amount strictly above the threshold");
    if (cap != null && factor > 0) {
      add("cap_hit", "Cap hit", { txn_amount: money(cap / factor + 1000), payment_rail: "CARD", card_segment: "COMMERCIAL_CREDIT" }, cap, "Fee is capped; expected equals the cap, not the uncapped percentage");
    }
    return tests;
  }

  if (kind === "merchant_rebate" && threshold != null) {
    add("exactly_threshold", `Exactly ${threshold.toLocaleString("en-IN")}`, { txn_amount: threshold }, 0, "Rebate applies only when amount exceeds the threshold");
    add("just_above", "Just above the threshold", { txn_amount: money(threshold + 0.01) }, (threshold + 0.01) * factor, "First amount strictly above the rebate threshold");
    add("well_above", "Well above the threshold", { txn_amount: money(threshold * 2) }, threshold * 2 * factor, "Rebate on a larger amount");
    return tests;
  }
  if ((kind === "merchant_mdr_tier" || kind === "partner_share_tier") && threshold != null) {
    const fb = fallback != null ? rateFactor(fallback, unit) : factor;
    add("exactly_threshold", `Exactly ${threshold.toLocaleString("en-IN")} (preferred tier)`, { txn_amount: threshold }, threshold * factor, "At the tier boundary the preferred rate applies");
    add("just_below", "Just below the tier", { txn_amount: money(threshold - 0.01) }, (threshold - 0.01) * fb, "Below the tier uses the fallback rate");
    return tests;
  }
  if (kind === "settlement_sla") {
    add("any_amount", "SLA rules do not compute a fee", { txn_amount: 10000 }, 0, "Settlement SLA is not a fee expression");
    return tests;
  }

  add("ten_thousand", "Amount 10,000", { txn_amount: 10000, payment_rail: "CARD" }, applyCap(10000 * factor), "Standard mid-size amount");
  add("just_above_10k", "Just above 10,000", { txn_amount: 10000.01, payment_rail: "CARD" }, applyCap(10000.01 * factor), "Boundary just above 10,000");
  if (cap != null && factor > 0) {
    add("cap_hit", "Cap hit", { txn_amount: money(cap / factor + 5000), payment_rail: "CARD" }, cap, "Capped fee");
  }
  return tests;
}

export async function executeFeeExpression(
  env: Env,
  expr: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const v = validateFeeExpression(expr);
  if (!v.ok) throw new Error(v.error);
  const selects = CANONICAL_COLUMNS.map((c) => {
    const key = c === "de4_amount" ? "txn_amount" : c === "de5_amount" ? "recon_amount" : c;
    return `${literalSql(c, inputs[key])} AS ${c}`;
  });
  const sqlText = `SELECT CAST((${v.sql}) AS NUMERIC(18,4)) AS expected_fee FROM (SELECT ${selects.join(", ")}) AS canonical_settlement`;
  const rows = await runReadOnlyNumeric(env, sqlText);
  const val = rows[0]?.expected_fee;
  if (val == null) throw new Error("Expression returned no value");
  return Number(val).toFixed(4);
}

function literalSql(col: string, raw: unknown): string {
  const bools = new Set(["is_rupay_credit", "is_ppi"]);
  const nums = new Set(["txn_amount", "actual_fee", "settlement_amount", "recon_amount", "de4_amount", "de5_amount", "irf"]);
  if (bools.has(col)) {
    const b = raw === true || raw === "true" || raw === "t" || raw === "Y" || raw === 1 || raw === "1";
    return b ? "TRUE" : "FALSE";
  }
  if (nums.has(col)) {
    const n = raw == null || raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid numeric input for ${col}`);
    return `CAST(${n.toFixed(4)} AS NUMERIC(18,4))`;
  }
  if (raw == null) return "NULL::text";
  return `'${String(raw).replace(/'/g, "''")}'::text`;
}

async function runReadOnlyNumeric(env: Env, sqlText: string): Promise<Record<string, unknown>[]> {
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(env.DATABASE_URL);
  const tx = (
    client as unknown as {
      transaction?: (fn: (sql: { query: (q: string, p?: unknown[]) => Promise<unknown> }) => Promise<unknown>[]) => Promise<unknown>;
    }
  ).transaction;
  if (typeof tx === "function") {
    const out = (await tx((sql) => [
      sql.query("SET LOCAL statement_timeout = 3000"),
      sql.query("SET TRANSACTION READ ONLY"),
      sql.query("SET LOCAL ROLE ra_readonly"),
      sql.query(sqlText),
    ])) as unknown[];
    const last = out[out.length - 1];
    return Array.isArray(last) ? (last as Record<string, unknown>[]) : [];
  }
  await client.query("SET statement_timeout = 3000");
  const rows = (await client.query(sqlText)) as Record<string, unknown>[];
  return rows ?? [];
}

export async function persistAndRunTests(
  env: Env,
  db: AppDb,
  ruleId: string,
  rule: StructuredRule,
  sqlExpression: string,
): Promise<{ tests: RuleTest[]; passed: boolean }> {
  const tests = generateRuleTests({ ...rule, rule_id: ruleId });
  let all = true;
  for (const t of tests) {
    try {
      const actual = await executeFeeExpression(env, sqlExpression, t.inputs);
      t.actual = actual;
      t.passed = actual === t.expected;
    } catch (err) {
      t.actual = null;
      t.passed = false;
      t.note = `${t.note ?? ""} Execution error: ${err instanceof Error ? err.message : String(err)}`.trim();
    }
    if (!t.passed) all = false;
    await db
      .prepare(
        `INSERT INTO ra_rule_tests (test_id, rule_id, name, inputs, expected_numeric, actual_numeric, passed, note, ran_at)
         VALUES (?, ?, ?, ?::jsonb, ?::numeric, ?::numeric, ?, ?, now())
         ON CONFLICT (test_id) DO UPDATE SET
           inputs=EXCLUDED.inputs, expected_numeric=EXCLUDED.expected_numeric,
           actual_numeric=EXCLUDED.actual_numeric, passed=EXCLUDED.passed, note=EXCLUDED.note, ran_at=now()`,
      )
      .bind(t.test_id, ruleId, t.name, JSON.stringify(t.inputs), t.expected, t.actual, t.passed ? 1 : 0, t.note ?? null)
      .run();
  }
  await db
    .prepare("UPDATE ra_extracted_rules SET tests_passed=?, sql_expression=? WHERE rule_id=?")
    .bind(all ? 1 : 0, sqlExpression, ruleId)
    .run();
  return { tests, passed: all };
}

export async function loadRuleTests(db: AppDb, ruleId: string): Promise<RuleTest[]> {
  const { results } = await db
    .prepare(
      `SELECT test_id, name, inputs, expected_numeric, actual_numeric, passed, note
       FROM ra_rule_tests WHERE rule_id=? ORDER BY test_id`,
    )
    .bind(ruleId)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({
    test_id: String(r.test_id),
    name: String(r.name),
    inputs: typeof r.inputs === "string" ? JSON.parse(String(r.inputs)) : ((r.inputs as Record<string, unknown>) ?? {}),
    expected: Number(r.expected_numeric).toFixed(4),
    actual: r.actual_numeric == null ? null : Number(r.actual_numeric).toFixed(4),
    passed: r.passed == null ? null : Boolean(Number(r.passed)),
    note: r.note == null ? undefined : String(r.note),
  }));
}
