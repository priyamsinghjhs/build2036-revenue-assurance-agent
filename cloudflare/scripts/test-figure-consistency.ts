import { normalizeAmount } from "../shared/numbers";
import { isExposureArea } from "../shared/bookLeakage";
import { bookTotalsFromAreas, overlayLiveSummary, type LiveAreaLeakage } from "../shared/bookLeakage";
import { canonicalReviewAmount } from "../shared/reviewAmount";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}
function nearly(a: number, b: number, msg: string, eps = 0.009) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > eps) {
    throw new Error(`${msg}: expected ${b} got ${a}`);
  }
}

type Heat = { area: string; leakage: number; exceptions: number };
type ExecLike = {
  kpis: { leakage: number; exception_count: number; revenue?: number };
  ageing: { bucket: string; n: number; leakage: number }[];
  waterfall: { name: string; value: number; kind: string }[];
  heatmap: Heat[];
  trend?: { day: string; leakage: number; n: number }[];
  period_compare?: { prior: number; current: number; delta: number };
};

export function assertExecutiveConsistency(exec: ExecLike): string[] {
  const problems: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) problems.push(msg);
  };
  const bookHeat = exec.heatmap.filter((h) => !isExposureArea(h.area));
  const heatL = normalizeAmount(bookHeat.reduce((s, h) => s + Number(h.leakage || 0), 0));
  const heatN = bookHeat.reduce((s, h) => s + Number(h.exceptions || 0), 0);
  check(Math.abs(heatL - exec.kpis.leakage) <= 0.009, `heatmap book leakage ${heatL} != kpi ${exec.kpis.leakage}`);
  check(heatN === exec.kpis.exception_count, `heatmap book n ${heatN} != kpi ${exec.kpis.exception_count}`);

  const ageL = normalizeAmount(exec.ageing.reduce((s, a) => s + Number(a.leakage || 0), 0));
  const ageN = exec.ageing.reduce((s, a) => s + Number(a.n || 0), 0);
  check(Math.abs(ageL - exec.kpis.leakage) <= 0.009, `ageing leakage ${ageL} != kpi ${exec.kpis.leakage}`);
  check(ageN === exec.kpis.exception_count, `ageing n ${ageN} != kpi ${exec.kpis.exception_count}`);

  const leakParts = normalizeAmount(
    exec.waterfall.filter((w) => w.kind === "leak").reduce((s, w) => s + Math.abs(Number(w.value || 0)), 0),
  );
  check(Math.abs(leakParts - exec.kpis.leakage) <= 0.009, `waterfall leaks ${leakParts} != kpi ${exec.kpis.leakage}`);
  const gross = Number(exec.waterfall.find((w) => w.kind === "total")?.value ?? 0);
  const net = Number(exec.waterfall.find((w) => w.kind === "net")?.value ?? 0);
  if (exec.kpis.revenue != null) {
    check(Math.abs(gross - exec.kpis.revenue) <= 0.009, `waterfall gross ${gross} != revenue ${exec.kpis.revenue}`);
  }
  check(Math.abs(normalizeAmount(gross - exec.kpis.leakage) - net) <= 0.009, `waterfall net ${net} != gross-leakage`);

  if (exec.trend && exec.period_compare) {
    const tL = normalizeAmount(exec.trend.reduce((s, t) => s + Number(t.leakage || 0), 0));
    const pc = normalizeAmount(exec.period_compare.prior + exec.period_compare.current);
    check(Math.abs(pc - tL) <= 0.009, `period_compare prior+current ${pc} != trend ${tL}`);
    check(
      Math.abs(normalizeAmount(exec.period_compare.current - exec.period_compare.prior) - exec.period_compare.delta) <= 0.009,
      "period_compare delta mismatch",
    );
  }
  return problems;
}

export function assertAreaConsistency(page: {
  summary: { leakage: number; exception_count: number };
  exceptions: { leakage?: number | string }[];
}): string[] {
  const problems: string[] = [];
  const listN = page.exceptions.length;
  const listL = normalizeAmount(page.exceptions.reduce((s, e) => s + Number(e.leakage || 0), 0));
  if (listN === Number(page.summary.exception_count) && Math.abs(listL - Number(page.summary.leakage)) > 0.009) {
    problems.push(`area summary leakage ${page.summary.leakage} != exception list ${listL} (n=${listN})`);
  }
  if (listN > Number(page.summary.exception_count)) {
    problems.push(`exception list length ${listN} exceeds summary ${page.summary.exception_count}`);
  }
  return problems;
}

export function assertReviewListDetail(
  listAmount: number,
  detailAmount: number,
  sqlLeakage: number | null,
  action: unknown,
  id: string,
): string[] {
  const expected = canonicalReviewAmount({
    leakage: sqlLeakage,
    hasException: sqlLeakage != null,
    action,
  });
  const problems: string[] = [];
  if (Math.abs(listAmount - detailAmount) > 0.009) problems.push(`${id}: list ${listAmount} != detail ${detailAmount}`);
  if (Math.abs(listAmount - expected) > 0.009) problems.push(`${id}: list ${listAmount} != canonical ${expected}`);
  if (Math.abs(detailAmount - expected) > 0.009) problems.push(`${id}: detail ${detailAmount} != canonical ${expected}`);
  return problems;
}

// --- overlay unit tests ---
const live = new Map<string, LiveAreaLeakage>([
  ["apm", { area: "apm", n: 10, leakage: 30437.64 }],
  ["cash_ar", { area: "cash_ar", n: 7, leakage: 52501.37 }],
  ["anomalies", { area: "anomalies", n: 4, leakage: 14430.2 }],
]);
let over = overlayLiveSummary({ area: "apm", leakage: 30439.99, exception_count: 10 }, live);
nearly(over.leakage, 30437.64, "apm overlay uses live leakage");
eq(over.exception_count, 10, "apm count");

over = overlayLiveSummary({ area: "cash_ar", leakage: 47545.53, exception_count: 6 }, live);
nearly(over.leakage, 52501.37, "cash_ar overlay uses live");
eq(over.exception_count, 7, "cash_ar live count");

over = overlayLiveSummary({ area: "network", leakage: 45.05, exception_count: 32 }, live);
nearly(over.leakage, 45.05, "network with no live rows keeps summary");
eq(over.exception_count, 32, "network count kept");

over = overlayLiveSummary({ area: "anomalies", leakage: 0, exception_count: 0 }, live);
nearly(over.leakage, 14430.2, "anomalies live fills a zero summary");
eq(over.exception_count, 4, "anomalies live n");

const book = bookTotalsFromAreas([
  { area: "apm", leakage: 30437.64, exception_count: 10 },
  { area: "network", leakage: 45.05, exception_count: 32 },
  { area: "aml", leakage: 907800, exception_count: 5 },
]);
nearly(book.leakage, 30482.69, "book total excludes AML");
eq(book.exception_count, 42, "book count excludes AML");

// --- synthetic executive payload must pass ---
const exec: ExecLike = {
  kpis: { leakage: 30482.69, exception_count: 42, revenue: 100000 },
  ageing: [
    { bucket: "8-30 days", n: 10, leakage: 30437.64 },
    { bucket: "unknown", n: 32, leakage: 45.05 },
  ],
  waterfall: [
    { name: "Gross revenue", value: 100000, kind: "total" },
    { name: "APM", value: -30437.64, kind: "leak" },
    { name: "Other leakage", value: -45.05, kind: "leak" },
    { name: "Net after leakage", value: 69517.31, kind: "net" },
  ],
  heatmap: [
    { area: "apm", leakage: 30437.64, exceptions: 10 },
    { area: "network", leakage: 45.05, exceptions: 32 },
    { area: "aml", leakage: 907800, exceptions: 5 },
  ],
  trend: [
    { day: "2026-10-04", leakage: 20000, n: 6 },
    { day: "2026-10-20", leakage: 10437.64, n: 4 },
  ],
  period_compare: { prior: 20000, current: 10437.64, delta: -9562.36 },
};
const execProblems = assertExecutiveConsistency(exec);
if (execProblems.length) throw new Error("synthetic exec failed:\n" + execProblems.join("\n"));

const areaProblems = assertAreaConsistency({
  summary: { leakage: 30437.64, exception_count: 10 },
  exceptions: Array.from({ length: 10 }, (_, i) => ({ leakage: i === 0 ? 14135.2 : (30437.64 - 14135.2) / 9 })),
});
if (areaProblems.length) throw new Error("area consistency failed:\n" + areaProblems.join("\n"));

// --- every fixture list/detail vs SQL ---
const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, "fixtures/review-items.json"), "utf8")) as {
  exception_id: string;
  action_json: unknown;
  sql: { leakage: string | number } | null;
}[];
let reviewProblems: string[] = [];
for (const item of items) {
  const expected = canonicalReviewAmount({
    leakage: item.sql?.leakage,
    hasException: item.sql != null,
    action: item.action_json,
  });
  reviewProblems = reviewProblems.concat(
    assertReviewListDetail(expected, expected, item.sql ? Number(item.sql.leakage) : null, item.action_json, item.exception_id),
  );
}
if (reviewProblems.length) throw new Error(reviewProblems.join("\n"));

console.log(`test-figure-consistency: overlay, exec invariants, ${items.length} review items ok`);
