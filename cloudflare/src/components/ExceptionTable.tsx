import { Link } from "react-router-dom";
import type { ExceptionRow } from "../api";
import { inr, prettyCat } from "../lib/format";
import { SeverityBadge } from "./SeverityBadge";

export function ExceptionTable({ rows, compact }: { rows: ExceptionRow[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-3 py-2">Severity</th>
            <th className="px-3 py-2">Gap</th>
            {!compact && <th className="px-3 py-2">Merchant</th>}
            <th className="px-3 py-2">Expected</th>
            <th className="px-3 py-2">Actual</th>
            <th className="px-3 py-2">Leakage</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.exception_id} className="border-t border-white/5 hover:bg-white/5">
              <td className="px-3 py-2"><SeverityBadge value={r.severity} /></td>
              <td className="px-3 py-2">
                <div className="font-medium capitalize text-slate-100">{prettyCat(r.category)}</div>
                <div className="text-[11px] text-slate-500">{r.recon_ref || r.ref_id}</div>
              </td>
              {!compact && <td className="px-3 py-2 text-slate-300">{r.merchant_id ?? "—"}</td>}
              <td className="px-3 py-2 tabular-nums">{inr(r.expected_amount, true)}</td>
              <td className="px-3 py-2 tabular-nums">{inr(r.actual_amount, true)}</td>
              <td className="px-3 py-2 tabular-nums text-rose-300">{inr(r.leakage, true)}</td>
              <td className="px-3 py-2 text-right">
                <Link
                  to={`/investigate/${encodeURIComponent(r.exception_id)}`}
                  className="text-xs font-medium text-cyan-300 hover:underline"
                >
                  Investigate
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                No exceptions
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
