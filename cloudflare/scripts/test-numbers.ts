import { normalizeAmount, normalizeConfidence, parseLooseNumber } from "../shared/numbers";
import { publicErrorMessage } from "../shared/errors";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

eq(normalizeConfidence("0.9"), 90, "fraction string");
eq(normalizeConfidence(0.9), 90, "fraction number");
eq(normalizeConfidence("90%"), 90, "percent string");
eq(normalizeConfidence("90"), 90, "integer string");
eq(normalizeConfidence(90), 90, "integer number");
eq(normalizeConfidence(1), 100, "one is 100%");
eq(normalizeConfidence("1"), 100, "one string is 100%");
eq(normalizeConfidence("0.9%"), 1, "tiny percent not scaled twice");
eq(normalizeConfidence(-5), 0, "clamp low");
eq(normalizeConfidence(150), 100, "clamp high");
eq(normalizeConfidence(""), 0, "empty");
eq(normalizeConfidence(null), 0, "null");
eq(normalizeConfidence("high"), 0, "garbage");
eq(normalizeConfidence("  75 % "), 75, "spaced percent");

eq(normalizeAmount("₹12,500"), 12500, "rupee commas");
eq(normalizeAmount("1.2L"), 120000, "L suffix");
eq(normalizeAmount("1.5 lakh"), 150000, "lakh word");
eq(normalizeAmount("2,50,000"), 250000, "indian grouping");
eq(normalizeAmount("₹ 0.5 Lakh"), 50000, "rupee + lakh");
eq(normalizeAmount(1234.567), 1234.57, "round money");
eq(normalizeAmount("0.9"), 0.9, "amount fraction stays");
eq(normalizeAmount(""), 0, "empty amount");

assert(parseLooseNumber("abc") == null, "loose garbage");

const sql = publicErrorMessage(new Error('invalid input syntax for type integer: "0.9"'));
assert(!sql.includes("0.9"), "must not leak postgres detail");
assert(/unexpected format/i.test(sql), `friendly sql: ${sql}`);
assert(publicErrorMessage(new Error("Unknown agent_id")).includes("Unknown agent_id"), "keep short app errors");

console.log("test-numbers ok");
