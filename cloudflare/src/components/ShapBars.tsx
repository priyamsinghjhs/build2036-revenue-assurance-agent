import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CategoryTick, chartMargin, TruncTick } from "@/components/ChartKit";
import { CHART, tooltipStyle } from "@/lib/chartTheme";
import { prettyCat } from "@/lib/format";

export type ShapRow = { feature: string; shap?: number; mean_abs_shap?: number; value?: number };

export function ShapBars({
  rows,
  title,
  mode = "signed",
}: {
  rows: ShapRow[];
  title?: string;
  mode?: "signed" | "abs";
}) {
  const data = rows
    .map((r) => ({
      name: prettyCat(r.feature).replace(/_/g, " "),
      shap: mode === "abs" ? Math.abs(Number(r.mean_abs_shap ?? r.shap ?? 0)) : Number(r.shap ?? r.mean_abs_shap ?? 0),
      value: r.value,
    }))
    .filter((r) => Number.isFinite(r.shap) && r.shap !== 0)
    .slice(0, 10);
  if (!data.length) return <p className="text-xs text-muted">No SHAP factors for this score.</p>;
  const height = Math.max(220, data.length * 36);
  return (
    <div className="min-w-0">
      {title ? <p className="mb-2 text-xs font-medium text-ink">{title}</p> : null}
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ ...chartMargin, left: 8, right: 56, top: 8, bottom: 8 }}>
            <CartesianGrid stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" tick={<TruncTick maxChars={8} />} />
            <YAxis type="category" dataKey="name" width={128} interval={0} tick={<CategoryTick textAnchor="end" maxCharsPerLine={16} />} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: unknown, _n, ctx) => {
                const rec = ctx?.payload as { value?: number } | undefined;
                const extra = rec?.value != null ? ` (value ${rec.value})` : "";
                return [`${Number(v).toFixed(3)}${extra}`, mode === "abs" ? "mean |SHAP|" : "SHAP"];
              }}
            />
            <Bar dataKey="shap" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.shap >= 0 ? CHART.leak : CHART.ok} />
              ))}
              <LabelList dataKey="shap" position="right" formatter={(v: unknown) => Number(v).toFixed(2)} style={{ fontSize: 10, fill: CHART.tick }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
