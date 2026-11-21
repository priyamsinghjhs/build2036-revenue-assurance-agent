import { useEffect, useState } from "react";
import { api, type TraceResult } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXAMPLES = ["AUTH00001", "CAP00004", "INV-MER005-2026-10", "SET-MER001-2026W40"];

export default function TracePage() {
  const [q, setQ] = useState("AUTH00001");
  const [data, setData] = useState<TraceResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void run("AUTH00001"); }, []);

  async function run(next = q) {
    setBusy(true);
    setError("");
    try {
      setData(await api.trace(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Transaction trace</h1>
        <p className="text-sm text-muted">
          Search any authorization, capture, batch, funding or invoice id and see its journey across hops — for disputes and audit.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="min-w-[16rem] flex-1 text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Reference</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="AUTH00001"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
          />
        </label>
        <Button type="submit" disabled={busy || !q.trim()}>{busy ? "Tracing…" : "Trace"}</Button>
      </form>
      <div className="flex flex-wrap gap-2 text-xs">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="rounded-full border border-line px-2 py-1 text-muted hover:text-ink"
            onClick={() => { setQ(ex); void run(ex); }}
          >
            {ex}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Journey</CardTitle>
            <CardDescription>
              {data.resolved
                ? `${data.resolved.kind} ${data.resolved.id}${data.resolved.merchant_id ? ` · ${data.resolved.merchant_id}` : ""}`
                : "No matching reference in the October book"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.steps.length === 0 ? (
              <p className="text-sm text-muted">Nothing to show. Try AUTH00001 or INV-MER005-2026-10.</p>
            ) : (
              <ol className="space-y-3">
                {data.steps.map((s, i) => (
                  <li key={`${s.hop}-${s.ref}-${i}`} className="flex gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        s.status === "missing" || s.status === "not_found" ? "bg-red-50 text-danger" : "bg-accent text-white",
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium capitalize text-ink">{s.hop}</span>
                        <span className="tabular-nums text-sm text-ink">{s.amount != null ? inr(s.amount, true) : "—"}</span>
                      </div>
                      <div className="truncate text-xs text-muted" title={`${s.ref} ${s.status} ${s.detail}`}>
                        {s.ref} · {s.status}
                        {s.ts ? ` · ${s.ts}` : ""}
                        {s.detail ? ` · ${s.detail}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
