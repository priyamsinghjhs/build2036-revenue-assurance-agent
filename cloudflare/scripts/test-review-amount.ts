import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAmount } from "../shared/numbers";
import {
  canonicalReviewAmount,
  exceptionIdParts,
  extractActionAmount,
} from "../shared/reviewAmount";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}
function nearly(a: number, b: number, msg: string, eps = 0.009) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: expected ${b} got ${a}`);
}

eq(exceptionIdParts("apm:apm_report_mismatch:APM0008")?.ref_id, "APM0008", "simple ref");
eq(
  exceptionIdParts("interfaces:interface_duplicates:2026-10-14:gateway")?.ref_id,
  "2026-10-14:gateway",
  "colon in ref_id is preserved",
);
eq(exceptionIdParts("too:short"), null, "short id rejected");

eq(extractActionAmount({ amount: 14135.2 }), 14135.2, "top-level amount");
eq(extractActionAmount({ recommended_amount: "1,200.50" }), 1200.5, "recommended_amount");
eq(
  extractActionAmount({ actions: [{ type: "dispute", amount: 14135.2 }] }),
  14135.2,
  "nested actions[0].amount",
);
eq(
  extractActionAmount({ actions: [{ amount: 10 }, { amount: 2.5 }] }),
  12.5,
  "sum of action amounts",
);
eq(extractActionAmount({ faithfulness: 1 }), null, "no amount");

eq(canonicalReviewAmount({ leakage: "14135.20", hasException: true, action: { actions: [{ amount: 0 }] } }), 14135.2, "prefer leakage");
eq(canonicalReviewAmount({ leakage: 0, hasException: true, action: { actions: [{ amount: 99 }] } }), 0, "genuine zero leakage wins");
eq(canonicalReviewAmount({ hasException: false, action: { actions: [{ amount: 2000 }] } }), 2000, "fallback to action");
eq(canonicalReviewAmount({ leakage: null, hasException: false, action: {} }), 0, "nothing");

// Legacy list mapping (buggy): only top-level action.amount
function legacyListAmount(action: unknown): number {
  const rec = action && typeof action === "object" ? (action as Record<string, unknown>) : {};
  const amt = Number(rec.amount ?? rec.recommended_amount ?? 0);
  return Number.isFinite(amt) ? amt : 0;
}

const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, "fixtures/review-items.json"), "utf8")) as {
  exception_id: string;
  action_json: unknown;
  sql: { leakage: string | number; category: string; merchant_id: string | null } | null;
  live_detail_exception: { leakage?: string | number; category?: string } | null;
}[];

let listMismatches = 0;
let wrongRow = 0;
for (const item of items) {
  const sqlLeak = item.sql ? normalizeAmount(item.sql.leakage) : null;
  const expected = canonicalReviewAmount({
    leakage: sqlLeak,
    hasException: item.sql != null,
    action: item.action_json,
  });
  const legacy = legacyListAmount(item.action_json);
  const fixedList = canonicalReviewAmount({
    leakage: sqlLeak,
    hasException: item.sql != null,
    action: item.action_json,
  });
  const liveDetail = canonicalReviewAmount({
    leakage: item.live_detail_exception?.leakage,
    hasException: item.live_detail_exception?.leakage != null || item.live_detail_exception?.category != null,
    action: item.action_json,
  });

  nearly(fixedList, expected, `${item.exception_id} fixed list vs SQL/canonical`);

  if (legacy !== expected) listMismatches += 1;
  if (item.sql && liveDetail !== expected) {
    wrongRow += 1;
    // The pre-fix detail lookup joined on trailing ref_id and could return a different row.
    if (item.exception_id.includes("INV-MER003")) {
      nearly(liveDetail, 733.33, "cash_ar pre-fix showed the pricing row");
      nearly(expected, 15801.7, "cash_ar correct leakage is unpaid_overdue");
    }
  }

  if (item.exception_id.endsWith("APM0008")) {
    eq(legacy, 0, "APM0008 list used to show 0");
    nearly(expected, 14135.2, "APM0008 correct leakage");
    nearly(liveDetail, 14135.2, "APM0008 detail leakage was already right (exact row existed)");
  }
  if (item.exception_id.includes("VISA-20261006")) {
    eq(item.sql, null, "VISA-20261006 has no exception row");
    nearly(expected, 2000, "falls back to action amount");
  }
}

if (listMismatches < 10) throw new Error(`expected most list rows to mismatch under the legacy mapper, got ${listMismatches}`);
if (wrongRow < 1) throw new Error("expected at least one pre-fix detail to use the wrong exception row");

console.log(`test-review-amount: ${items.length} items, legacy list mismatches ${listMismatches}, pre-fix wrong-row details ${wrongRow}`);
