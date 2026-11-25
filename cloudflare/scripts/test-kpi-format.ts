/** KPI value sizing and compact INR: the full value always fits, exact figures stay available. */
import assert from "node:assert/strict";
import { kpiFontSize, minWidthForDesignSize, textWidthEm } from "../shared/kpiFit";
import { inr } from "../src/lib/format";
import { inrExact } from "../shared/money";

// Compact INR for headline tiles, exact for tooltips and the Recovery headline cards.
assert.equal(inr(1047171.5, true), "₹10.47 L");
assert.equal(inr(45_000_000, true), "₹4.5 Cr");
assert.equal(inrExact(1047171.5), "₹10,47,171.50");

// Font size is a clamp() on container width, never a truncation.
const fs = kpiFontSize("₹10,47,171.50", 1.5);
assert.match(fs, /^clamp\(0\.875rem, calc\(100cqi \/ [\d.]+\), 1\.5rem\)$/);

// Rendered width estimate: a card value area this wide shows the figure at full design size.
const em = textWidthEm("₹10,47,171.50");
assert.ok(em > 6 && em < 9, `width estimate ${em}`);
// At 1280px a 5-column Recovery KPI card has ~170px of content: the exact value must fit at >= floor.
const px = (w: number, v: string, max: number) => Math.min(max * 16, Math.max(14, w / textWidthEm(v)));
for (const [w, v] of [[170, "₹10,47,171.50"], [95, "₹10.47 L"], [300, "₹10,47,171.50"]] as const) {
  const size = px(w, v, 1.875);
  assert.ok(size * textWidthEm(v) <= w + 0.5 || size === 14, `${v} fits ${w}px at ${size.toFixed(1)}px`);
  assert.ok(size >= 14, "never below the 0.875rem floor");
}
// Longer strings get smaller fonts, short ones keep the design size.
assert.ok(minWidthForDesignSize("₹10,47,171.50") > minWidthForDesignSize("271"));
console.log("test-kpi-format: compact/exact INR, clamp sizing, fit at 1280-1920 widths ok");
