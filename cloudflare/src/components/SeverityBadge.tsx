export function SeverityBadge({ value }: { value: "high" | "medium" | "low" | string }) {
  const cls =
    value === "high" || value === "critical"
      ? "bg-rose-500/20 text-rose-300 ring-rose-500/30"
      : value === "medium" || value === "watch"
        ? "bg-amber-500/20 text-amber-300 ring-amber-500/30"
        : "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      {value}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "matched" || status === "completed" || status === "cached"
      ? "bg-emerald-400"
      : status === "unmatched" || status === "error"
        ? "bg-rose-400"
        : status === "running"
          ? "bg-cyan-400 animate-pulse"
          : "bg-amber-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
