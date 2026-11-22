import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

export const BASE = process.env.BASE_URL || "https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev";
export const BOOK_SQL = "area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')";
export const EXPOSURE = ["aml","network_risk","kyc","success","interfaces","anomalies","files"];
export const RESULTS = process.env.RESULTS_DIR || "/workspace/verify/regression";

export function loadBranchUrl() {
  const fromEnv = process.env.REGRESSION_DATABASE_URL;
  if (fromEnv) return fromEnv.trim();
  const p = process.env.REGRESSION_DATABASE_URL_FILE || "/workspace/secrets/neon_regression_url";
  return readFileSync(p, "utf8").trim();
}

export function db() {
  const url = loadBranchUrl();
  if (!url) throw new Error("REGRESSION_DATABASE_URL is not set");
  return neon(url, { fetchOptions: { timeout: 180000 } });
}

export async function api(path, opts = {}) {
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(BASE + path, {
        ...opts,
        headers: { "content-type": "application/json", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(45_000),
      });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 400) }; }
      return { status: r.status, ok: r.ok, body, ms: Date.now() - t0, text: text.slice(0, 400) };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export function nearly(a, b, eps = 0.05) {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= eps;
}

export class Scorecard {
  constructor() {
    this.rows = [];
    this.bugs = [];
    this.remaining = [];
    this.notes = [];
  }
  add(agent, { functional = null, technical = null, autonomous = null, detail = "" } = {}) {
    const existing = this.rows.find((r) => r.agent === agent);
    if (existing) {
      if (functional != null) existing.functional = functional;
      if (technical != null) existing.technical = technical;
      if (autonomous != null) existing.autonomous = autonomous;
      if (detail) existing.detail = [existing.detail, detail].filter(Boolean).join("; ");
      return existing;
    }
    const row = { agent, functional, technical, autonomous, detail };
    this.rows.push(row);
    return row;
  }
  pass(agent, field, detail = "") {
    this.add(agent, { [field]: "pass", detail });
  }
  fail(agent, field, detail) {
    this.add(agent, { [field]: "fail", detail });
  }
  write(extra = {}) {
    mkdirSync(RESULTS, { recursive: true });
    const totals = {
      functional: tally(this.rows, "functional"),
      technical: tally(this.rows, "technical"),
      autonomous: tallyAuto(this.rows),
    };
    const report = { generated_at: new Date().toISOString(), totals, rows: this.rows, bugs: this.bugs, remaining: this.remaining, notes: this.notes, ...extra };
    writeFileSync(`${RESULTS}/scorecard.json`, JSON.stringify(report, null, 2));
    const lines = [
      "# Revenue assurance regression scorecard",
      "",
      `Generated: ${report.generated_at}`,
      "",
      `Functional: ${totals.functional.pass} pass / ${totals.functional.fail} fail / ${totals.functional.skip} skip`,
      `Technical: ${totals.technical.pass} pass / ${totals.technical.fail} fail / ${totals.technical.skip} skip`,
      `Autonomy: ${totals.autonomous.yes} yes / ${totals.autonomous.gated} gated / ${totals.autonomous.no} no / ${totals.autonomous.skip} skip`,
      "",
      "| Agent | Functional | Technical | Autonomous | Detail |",
      "| --- | --- | --- | --- | --- |",
      ...this.rows.map((r) => `| ${r.agent} | ${r.functional ?? "—"} | ${r.technical ?? "—"} | ${r.autonomous ?? "—"} | ${(r.detail || "").replace(/\|/g, "\\|")} |`),
      "",
      "## Bugs found / fixed",
      ...(this.bugs.length ? this.bugs.map((b) => `- ${b}`) : ["- none"]),
      "",
      "## Remaining issues",
      ...(this.remaining.length ? this.remaining.map((b) => `- ${b}`) : ["- none"]),
      "",
      "## Notes",
      ...this.notes.map((n) => `- ${n}`),
      "",
    ];
    writeFileSync(`${RESULTS}/SCORECARD.md`, lines.join("\n"));
    return report;
  }
}

function tally(rows, field) {
  const out = { pass: 0, fail: 0, skip: 0 };
  for (const r of rows) {
    const v = r[field];
    if (v === "pass") out.pass++;
    else if (v === "fail") out.fail++;
    else out.skip++;
  }
  return out;
}
function tallyAuto(rows) {
  const out = { yes: 0, gated: 0, no: 0, skip: 0 };
  for (const r of rows) {
    const v = r.autonomous;
    if (v === "yes") out.yes++;
    else if (v === "gated") out.gated++;
    else if (v === "no") out.no++;
    else out.skip++;
  }
  return out;
}
