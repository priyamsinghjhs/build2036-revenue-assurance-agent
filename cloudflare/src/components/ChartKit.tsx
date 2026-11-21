import type { CSSProperties } from "react";
import { Legend } from "recharts";

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
  index,
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
  if (index === 0) return <g />;

  const raw = formatter ? formatter(payload?.value) : String(payload?.value ?? "");
  const full = String(payload?.value ?? raw);
  const text = raw.length > maxChars ? `${raw.slice(0, Math.max(1, maxChars - 1))}…` : raw;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text
        fill={fill}
        fontSize={10}
        textAnchor={textAnchor}
        transform={angle ? `rotate(${angle})` : undefined}
        style={{ width }}
      >
        {text}
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
