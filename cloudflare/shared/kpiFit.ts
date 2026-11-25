/**
 * KPI value sizing: the value is never truncated. Its font size scales with the width of its
 * own container (CSS container query units) so the full string fits, between a floor and the
 * design size. Pure so it can be unit-tested.
 */

/** Approximate advance width of a glyph in em for a semibold tabular-figure UI font. */
function glyphEm(ch: string): number {
  if (/[0-9]/.test(ch)) return 0.62;
  if (ch === "," || ch === "." || ch === ":" || ch === "·") return 0.3;
  if (ch === " ") return 0.28;
  if (ch === "₹" || ch === "%") return 0.66;
  if (ch === "−" || ch === "-" || ch === "+") return 0.62;
  if (/[A-Z]/.test(ch)) return 0.7;
  return 0.58;
}

/** Estimated rendered width of `value` in em (with a small safety margin). */
export function textWidthEm(value: string): number {
  let w = 0;
  for (const ch of value) w += glyphEm(ch);
  return Math.max(1, w * 1.06);
}

/**
 * CSS font-size that fits `value` in its inline-size container:
 * clamp(minRem, 100cqi / widthEm, maxRem). Requires `container-type: inline-size` on the parent.
 */
export function kpiFontSize(value: string, maxRem = 1.875, minRem = 0.875): string {
  const em = textWidthEm(value);
  return `clamp(${minRem}rem, calc(100cqi / ${em.toFixed(2)}), ${maxRem}rem)`;
}

/** Smallest container width (px) at which `value` renders at the design size. */
export function minWidthForDesignSize(value: string, maxRem = 1.875, rootPx = 16): number {
  return Math.ceil(textWidthEm(value) * maxRem * rootPx);
}
