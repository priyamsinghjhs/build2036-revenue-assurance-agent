import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { kpiFontSize } from "../../shared/kpiFit";

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  exact,
}: {
  label: string;
  value: string;
  /** Exact figure for the tooltip when `value` is compact. */
  exact?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "leak" | "ok" | "neutral" | "warn";
}) {
  const valueColor =
    tone === "leak" ? "text-danger" : tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-ink";
  return (
    <Card className="min-w-0 overflow-hidden p-4">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="min-w-0 truncate" title={label}>{label}</span>
        {icon}
      </div>
      <div className="mt-2 [container-type:inline-size]">
        <div
          className={cn("whitespace-nowrap font-semibold leading-tight tabular-nums", valueColor)}
          style={{ fontSize: kpiFontSize(value, 1.5) }}
          title={exact && exact !== value ? `${value} = ${exact}` : value}
          data-kpi-value
        >
          {value}
        </div>
      </div>
      {hint && <div className="mt-1 break-words text-xs text-muted">{hint}</div>}
    </Card>
  );
}
