import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRANSACTION_COLUMNS,
  SETTLEMENT_COLUMNS,
  pandasToString,
} from "../worker/format.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "format_fixtures.json"), "utf8"),
) as {
  settlement_to_string: Record<string, string>;
  txns_to_string_index_false: Record<string, string>;
};

function parseRow(header: string[], values: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  header.forEach((key, i) => {
    row[key] = values[i];
  });
  return row;
}

function splitLine(line: string, widths: number[], start: number): string[] {
  const cells: string[] = [];
  let pos = start;
  for (let i = 0; i < widths.length; i++) {
    const end = pos + widths[i];
    cells.push(line.slice(pos, end).trim());
    pos = end + 1;
  }
  return cells;
}

let failures = 0;

for (const [sid, expected] of Object.entries(fixtures.settlement_to_string)) {
  // Rebuild a row from the fixture header/value rather than D1, then format.
  const [headerLine, valueLine] = expected.split("\n");
  const keys = headerLine.trim().split(/\s+/);
  // Use known field values from the fixture line via regex on settlement_id etc.
  const match = valueLine.match(
    /^\s*\d+\s+(SET\d+)\s+(MER\d+)\s+(\d+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(\S+)\s*$/,
  );
  if (!match) {
    console.error("Could not parse fixture for", sid, valueLine);
    failures += 1;
    continue;
  }
  const row = {
    settlement_id: match[1],
    merchant_id: match[2],
    expected_amount: Number(match[3]),
    settled_amount: Number(match[4]),
    settlement_date: match[5],
    status: match[6],
    fee_rate: Number(match[7]),
  };
  const actual = pandasToString([row], SETTLEMENT_COLUMNS, { index: true, indexLabels: [0] });
  if (actual !== expected) {
    console.error(`MISMATCH settlement ${sid}`);
    console.error("expected:\n" + JSON.stringify(expected));
    console.error("actual:\n" + JSON.stringify(actual));
    failures += 1;
  }
}

for (const [sid, expected] of Object.entries(fixtures.txns_to_string_index_false)) {
  const lines = expected.split("\n");
  const header = lines[0].trim().split(/\s+/);
  // txn lines: TXN00001       SET0001      50 2026-10-25 00:00:00 refund
  const rows = lines.slice(1).map((line) => {
    const m = line.trim().match(
      /^(TXN\d+)\s+(SET\d+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\S+)\s*$/,
    );
    if (!m) throw new Error(`bad txn line for ${sid}: ${line}`);
    return {
      txn_id: m[1],
      settlement_id: m[2],
      amount: Number(m[3]),
      txn_date: m[4],
      type: m[5],
    };
  });
  const actual = pandasToString(rows, TRANSACTION_COLUMNS, { index: false });
  if (actual !== expected) {
    console.error(`MISMATCH txns ${sid}`);
    console.error("expected:\n" + JSON.stringify(expected));
    console.error("actual:\n" + JSON.stringify(actual));
    failures += 1;
  }
}

if (failures) {
  console.error(`FAILED ${failures} fixture(s)`);
  process.exit(1);
}
console.log(
  `OK ${Object.keys(fixtures.settlement_to_string).length} settlements, ${Object.keys(fixtures.txns_to_string_index_false).length} txn tables`,
);
