import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ExceptionRow } from "@/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Table, TD, TH, THead } from "@/components/ui/table";
import { inr, prettyCat } from "@/lib/format";
import { cn } from "@/lib/utils";

type Key = "severity" | "category" | "merchant_id" | "expected_amount" | "actual_amount" | "leakage" | "ts";

export function ExceptionTable({
  rows,
  compact,
  onSelect,
}: {
  rows: ExceptionRow[];
  compact?: boolean;
  onSelect?: (row: ExceptionRow) => void;
}) {
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "leakage", dir: "desc" });
  const ordered = useMemo(() => {
    const copy = [...rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
    return copy;
  }, [rows, sort]);

  function toggle(key: Key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "leakage" ? "desc" : "asc" }));
  }

  const head = (key: Key, label: string, className?: string) => (
    <TH className={cn("cursor-pointer select-none hover:text-ink", className)}>
      <button type="button" onClick={() => toggle(key)} className="inline-flex items-center gap-1">
        {label}
        {sort.key === key ? <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </TH>
  );

  return (
    <Table>
      <THead>
        <tr>
          {head("severity", "Severity")}
          {head("category", "Gap")}
          {!compact && head("merchant_id", "Merchant")}
          {head("expected_amount", "Expected")}
          {head("actual_amount", "Actual")}
          {head("leakage", "Leakage")}
          <TH></TH>
        </tr>
      </THead>
      <tbody>
        {ordered.map((r) => (
          <tr
            key={r.exception_id}
            className={cn("hover:bg-slate-50", onSelect && "cursor-pointer")}
            onClick={() => onSelect?.(r)}
          >
            <TD><SeverityBadge value={r.severity} /></TD>
            <TD>
              <div className="font-medium capitalize text-ink">{prettyCat(r.category)}</div>
              <div className="text-[11px] text-muted">{r.recon_ref || r.ref_id}</div>
            </TD>
            {!compact && <TD className="text-muted">{r.merchant_id ?? "—"}</TD>}
            <TD className="tabular-nums">{inr(r.expected_amount, true)}</TD>
            <TD className="tabular-nums">{inr(r.actual_amount, true)}</TD>
            <TD className="tabular-nums font-medium text-danger">{inr(r.leakage, true)}</TD>
            <TD className="text-right">
              <Link
                to={`/investigate/${encodeURIComponent(r.exception_id)}`}
                className="text-xs font-medium text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Investigate
              </Link>
            </TD>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <TD colSpan={7} className="py-8 text-center text-muted">No exceptions in this view</TD>
          </tr>
        )}
      </tbody>
    </Table>
  );
}
