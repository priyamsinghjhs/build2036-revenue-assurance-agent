import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART, tooltipStyle } from "@/lib/chartTheme";

export type SparkPoint = { day: string; value: number };

export function Sparkline({
  points,
  color = CHART.accent,
  label,
}: {
  points: SparkPoint[];
  color?: string;
  label?: string;
}) {
  if (!points.length) return null;
  return (
    <div className="h-12 w-full min-w-[96px]" aria-hidden={label ? undefined : true} aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [Number(v ?? 0).toLocaleString("en-IN"), ""]}
            labelFormatter={(l) => String(l)}
          />
          <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={1.6} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
