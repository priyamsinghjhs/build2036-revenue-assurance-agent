import type { ReactNode } from "react";

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
  tone?: "leak" | "ok" | "neutral";
}) {
  const border =
    tone === "leak" ? "border-rose-500/40" : tone === "ok" ? "border-emerald-500/30" : "border-white/10";
  return (
    <div className={`rounded-2xl border ${border} bg-[#101827]/90 p-4 shadow-lg shadow-black/20`}>
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-slate-400">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
