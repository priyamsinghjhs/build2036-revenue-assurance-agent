import { pct } from "@/lib/format";

export function StatusBar({
  matched,
  unmatched,
  variance,
}: {
  matched: number;
  unmatched: number;
  variance: number;
}) {
  const total = matched + unmatched + variance || 1;
  const segs = [
    { label: "Matched", n: matched, className: "bg-success" },
    { label: "Unmatched", n: unmatched, className: "bg-danger" },
    { label: "Variance", n: variance, className: "bg-warning" },
  ];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Reconciliation status">
        {segs.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.className}`} />
            {s.label} {s.n} ({pct(s.n / total)})
          </span>
        ))}
      </div>
    </div>
  );
}
