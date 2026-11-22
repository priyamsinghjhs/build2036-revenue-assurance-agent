import type { CSSProperties } from "react";
import { Legend } from "recharts";

function tickText(
  payload: { value?: unknown } | undefined,
  formatter?: (value: unknown) => string,
): { raw: string; full: string } {
  const raw = formatter ? formatter(payload?.value) : String(payload?.value ?? "");
  const full = String(payload?.value ?? raw);
  return { raw, full };
}

/** Thin dense day axes so adjacent date labels do not overlap. Bar/category axes should keep interval={0}. */
export function dayTickInterval(pointCount: number, widthHint = 1280): number {
  const target = widthHint < 500 ? 4 : widthHint < 1100 ? 6 : 8;
  if (pointCount <= target) return 0;
  return Math.max(1, Math.ceil(pointCount / target) - 1);
}

/** SVG tick that truncates long labels and exposes the full value via <title> (tooltip). */
export function TruncTick({
  x = 0,
  y = 0,
  payload,
  fill = "#94a3b8",
  textAnchor = "middle",
  angle = 0,
  maxChars = 12,
  width,
  formatter,
}: {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  angle?: number;
  maxChars?: number;
  width?: number;
  formatter?: (value: unknown) => string;
  index?: number;
}) {
  const { raw, full } = tickText(payload, formatter);
  const text = raw.length > maxChars ? `${raw.slice(0, Math.max(1, maxChars - 1))}…` : raw;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text
        fill={fill}
        fontSize={10}
        textAnchor={textAnchor}
        dy={angle ? 6 : 0}
        transform={angle ? `rotate(${angle})` : undefined}
        style={{ width }}
      >
        {text}
      </text>
    </g>
  );
}

function wrapLabel(text: string, maxCharsPerLine: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxCharsPerLine) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.length ? lines : [text];
  const kept = lines.slice(0, maxLines);
  const overflow = lines.slice(maxLines).join(" ");
  const last = `${kept[maxLines - 1]} ${overflow}`.trim();
  kept[maxLines - 1] = last.length > maxCharsPerLine ? `${last.slice(0, Math.max(1, maxCharsPerLine - 1))}…` : last;
  return kept;
}

/**
 * Category-axis tick: wrap onto two lines instead of skipping or ellipsizing mid-name.
 * Always renders index 0 so the tick count matches the bar count.
 */
export function CategoryTick({
  x = 0,
  y = 0,
  payload,
  fill = "#94a3b8",
  textAnchor = "end",
  maxCharsPerLine = 16,
  formatter,
}: {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  maxCharsPerLine?: number;
  width?: number;
  formatter?: (value: unknown) => string;
  index?: number;
  angle?: number;
}) {
  const { raw, full } = tickText(payload, formatter);
  const lines = wrapLabel(raw, maxCharsPerLine, 2);
  const lineH = 12;
  const offset = ((lines.length - 1) * lineH) / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text fill={fill} fontSize={10} textAnchor={textAnchor}>
        {lines.map((ln, i) => (
          <tspan key={i} x={0} dy={i === 0 ? -offset + 3 : lineH}>
            {ln}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export const chartMargin = { top: 12, right: 16, left: 12, bottom: 8 };

export function WrappedLegend() {
  const style: CSSProperties = {
    fontSize: 11,
    paddingTop: 8,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    lineHeight: 1.3,
  };
  return <Legend iconSize={8} wrapperStyle={style} />;
}
