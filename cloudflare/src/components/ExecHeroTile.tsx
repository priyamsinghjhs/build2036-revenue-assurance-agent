import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Sparkline, type SparkPoint } from "@/components/Sparkline";
import { cn } from "@/lib/utils";
import { CHART } from "@/lib/chartTheme";
import { kpiFontSize } from "../../shared/kpiFit";

export function ExecHeroTile({
  label,
  value,
  hint,
  tone = "neutral",
  spark,
  delta,
  testId,
  exact,
}: {
  label: string;
  value: string;
  /** Exact figure shown on hover when `value` is a compact (₹ L / Cr) rendering. */
  exact?: string;
  hint?: string;
  tone?: "leak" | "ok" | "neutral" | "warn";
  spark?: SparkPoint[];
  delta?: { display: string; up?: boolean };
  testId?: string;
}) {
  const valueColor =
    tone === "leak" ? "text-danger" : tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-ink";
  const sparkColor = tone === "leak" ? CHART.leak : tone === "ok" ? CHART.ok : CHART.accent;
  return (
    <Card className="min-w-0 overflow-hidden p-4" data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="truncate" title={label}>{label}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <div
            className={cn("whitespace-nowrap font-semibold leading-tight tabular-nums", valueColor)}
            style={{ fontSize: kpiFontSize(value) }}
            title={exact && exact !== value ? `${value} = ${exact}` : value}
            data-kpi-value
          >
            {value}
          </div>
          {delta && (
            <div className={cn("mt-1 text-xs font-medium tabular-nums", delta.up ? "text-danger" : "text-success")}>
              {delta.display}
            </div>
          )}
          {hint && <div className="mt-1 break-words text-xs text-muted">{hint}</div>}
        </div>
        {spark && spark.length > 1 && (
          <div className="w-[36%] max-w-[140px] shrink-0">
            <Sparkline points={spark} color={sparkColor} label={`${label} trend`} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function ActionNeededCard({
  title,
  value,
  detail,
  to,
  tone = "warn",
}: {
  title: string;
  value: string;
  detail: string;
  to: string;
  tone?: "warn" | "ok" | "leak";
}) {
  const border = tone === "ok" ? "border-emerald-100" : tone === "leak" ? "border-red-100" : "border-amber-100";
  return (
    <Link
      to={to}
      className={cn("block min-w-0 rounded-xl border bg-white p-3 transition hover:shadow-sm", border)}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "ok" ? "text-success" : tone === "leak" ? "text-danger" : "text-warning")}>{value}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </Link>
  );
}

