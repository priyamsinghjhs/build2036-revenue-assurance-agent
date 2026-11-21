import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
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
      <div className={cn("mt-2 truncate text-2xl font-semibold leading-tight tabular-nums", valueColor)} title={value}>
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-muted" title={hint}>{hint}</div>}
    </Card>
  );
}
