import { useEffect, useState } from "react";
import { api, type AskResult } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inrExact } from "../../shared/money";

const FALLBACK_CHIPS = [
  "Top 5 merchants by leakage",
  "Total scheme leakage in October",
  "Which acquirer has the lowest success rate",
  "Show unmatched bank transactions above ₹10,000",
  "FX markup by currency",
  "Which domains have the most leakage?",
  "Show unapplied contract rebate exceptions",
  "List open cases with leakage over 10000",
  "What is the total book leakage",
  "Approval rate by scheme",
];

function formatCell(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && /leakage|amount|recovery|fee|total|inr/.test(key) && !/rate|count|bps/.test(key)) {
    return inrExact(value);
  }
  if (typeof value === "number" && /rate|success|approval|match/.test(key) && Math.abs(value) <= 1.5) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return String(value);
}

function progressLabel(busy: boolean, source?: string): string {
  if (!busy) return "";
  if (source === "template") return "Running a verified query…";
  if (source === "llm") return "Writing SQL… this can take a few seconds.";
  return "Matching a known question…";
}

export default function AskPage() {
  const [q, setQ] = useState(FALLBACK_CHIPS[0]);
  const [chips, setChips] = useState<string[]>(FALLBACK_CHIPS);
  const [data, setData] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");

  useEffect(() => {
    fetch("/api/ask/schema")
      .then((r) => r.json())
      .then((s) => {
        if (Array.isArray(s.suggested) && s.suggested.length) setChips(s.suggested as string[]);
      })
      .catch(() => undefined);
  }, []);

  async function run(question = q) {
    const text = question.trim();
    if (!text) return;
    setQ(text);
    setBusy(true);
    setError("");
    setPhase("Matching a known question…");
    try {
      const res = await api.ask(text);
      setData(res);
      if (res.status !== "ok") setError(res.error || "The question could not be answered.");
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  const rows = data?.rows ?? [];
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const numeric = keys.filter((k) =>
    rows.every((r) => r[k] == null || typeof r[k] === "number" || (typeof r[k] === "string" && r[k] !== "" && !Number.isNaN(Number(r[k])))),
  );
  const labelKey = keys.find((k) => !numeric.includes(k)) ?? keys[0];
  const valueKey = numeric.find((k) => /leakage|amount|markup|rate|total/.test(k)) ?? numeric.find((k) => k !== labelKey) ?? numeric[0];
  const max = valueKey ? Math.max(...rows.map((r) => Math.abs(Number(r[valueKey] || 0))), 1) : 1;

  return (
    <div className="space-y-6" data-testid="ask-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ask your data</h1>
        <p className="text-sm text-muted">
          Common questions run instantly on vetted SQL against allow-listed views. Anything else can fall back to a
          compact text-to-SQL model. Answers use only the query results. Generated SQL is always shown.
        </p>
      </header>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label className="min-w-[16rem] flex-1 text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Question</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            placeholder="Ask about leakage, schemes, acquirers…"
            data-testid="ask-input"
          />
        </label>
        <Button type="submit" disabled={busy || !q.trim()} data-testid="ask-submit">
          {busy ? "Asking…" : "Ask"}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2 text-xs" data-testid="ask-chips">
        {chips.map((ex) => (
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
      {busy && (
        <p className="text-sm text-muted" data-testid="ask-progress">{phase || progressLabel(true)}</p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-danger" data-testid="ask-error">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void run()}>Retry</Button>
        </div>
      )}
      {data && (
        <>
          {data.answer && (data.status === "ok" || data.status === "refused") && (
            <Card data-testid="ask-answer">
              <CardHeader>
                <CardTitle>Answer</CardTitle>
                <CardDescription>
                  {data.source === "template" ? "Verified question template" : data.source === "sql" ? "Allow-listed SQL" : "Model-written SQL, numbers from the query"}
                  {data.cached ? " · cached" : ""}
                  {data.timing_ms != null ? ` · ${data.timing_ms} ms` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-ink">{data.answer}</p>
              </CardContent>
            </Card>
          )}
          <Card data-testid="ask-sql">
            <CardHeader>
              <CardTitle>Generated SQL</CardTitle>
              <CardDescription>Status: {data.status}{data.error ? ` · ${data.error}` : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-ink">{data.sql || "—"}</pre>
            </CardContent>
          </Card>
          {!!rows.length && valueKey && labelKey && (
            <Card data-testid="ask-chart">
              <CardHeader><CardTitle>Chart</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {rows.slice(0, 12).map((r, i) => (
                  <div key={i} className="min-w-0">
                    <div className="mb-1 flex justify-between gap-3 text-xs">
                      <span className="truncate" title={String(r[labelKey])}>{String(r[labelKey])}</span>
                      <span className="tabular-nums">{formatCell(valueKey, r[valueKey])}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((Math.abs(Number(r[valueKey] || 0)) / max) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {!!rows.length && (
            <Card data-testid="ask-table">
              <CardHeader>
                <CardTitle>Table</CardTitle>
                <CardDescription>{rows.length} rows</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr>{keys.map((k) => <th key={k} className="pb-2 pr-3">{k.replace(/_/g, " ")}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {keys.map((k) => (
                          <td key={k} className="max-w-[220px] truncate py-2 pr-3 tabular-nums" title={formatCell(k, r[k])}>
                            {formatCell(k, r[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
