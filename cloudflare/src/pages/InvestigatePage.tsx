import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Play, RefreshCw } from "lucide-react";
import { api, type ExceptionRow } from "@/api";
import { ExceptionTable } from "@/components/ExceptionTable";
import { SeverityBadge } from "@/components/SeverityBadge";
import { inr, prettyCat } from "@/lib/format";
import { publicErrorMessage } from "../../shared/errors";
import { normalizeAmount, normalizeConfidence } from "../../shared/numbers";

const STEPS = ["investigator", "action", "auditor"] as const;

export default function InvestigatePage() {
  const { exceptionId } = useParams();
  const [row, setRow] = useState<ExceptionRow | null>(null);
  const [pool, setPool] = useState<ExceptionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<string>("");
  const [outputs, setOutputs] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    api
      .overview()
      .then(async (ov) => {
        const areas = ov.areas.filter((a) => a.exception_count > 0).slice(0, 4);
        const details = await Promise.all(areas.map((a) => api.area(a.area)));
        setPool(details.flatMap((d) => d.exceptions).slice(0, 20));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!exceptionId) {
      setRow(null);
      return;
    }
    api
      .exception(exceptionId)
      .then((r) => setRow(r.exception))
      .catch((e) => setError(publicErrorMessage(e, "Couldn't load this exception. Please try another.")));
    api
      .latest(`exception:${exceptionId}`)
      .then((r) => {
        const next: Record<string, Record<string, unknown>> = {};
        for (const o of r.latest?.outputs ?? []) {
          const out = o.output;
          if (out && typeof out === "object") next[o.agent_id] = out as Record<string, unknown>;
        }
        setOutputs(next);
      })
      .catch(() => undefined);
  }, [exceptionId]);

  async function run() {
    if (!row) return;
    setBusy(true);
    setError("");
    setOutputs({});
    try {
      const started = await api.startRun({ scope: `exception:${row.exception_id}`, domain: row.area });
      const next: Record<string, Record<string, unknown>> = {};
      for (const agentId of STEPS) {
        setStep(agentId);
        const res = await api.step({
          run_id: started.run_id,
          agent_id: agentId,
          scope: `exception:${row.exception_id}`,
          domain: row.area,
          exception_id: row.exception_id,
        });
        next[agentId] = res.output as Record<string, unknown>;
        setOutputs({ ...next });
      }
      await api.complete(started.run_id);
      setStep("");
    } catch (e) {
      setError(publicErrorMessage(e, "The investigation could not be completed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Investigate</h1>
        <p className="text-sm text-muted">On-demand agent pipeline for a single exception</p>
      </header>

      {!row && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Pick an exception</h2>
          <ExceptionTable rows={pool} />
        </section>
      )}

      {row && (
        <>
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <SeverityBadge value={row.severity} />
                  <span className="font-semibold capitalize">{prettyCat(row.category)}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {row.recon_ref || row.ref_id} · {row.merchant_id ?? "—"} · {row.area}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-muted">Leakage</div>
                <div className="text-xl font-semibold text-danger">{inr(row.leakage, true)}</div>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={run}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? `Running ${step}…` : "Run investigation"}
            </button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </div>

          <ol className="grid gap-3 md:grid-cols-3">
            {STEPS.map((id, i) => {
              const out = outputs[id];
              const active = step === id;
              return (
                <li key={id} className="rounded-xl border border-line bg-white p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted">
                    Step {i + 1} {active ? "· running" : out ? "· done" : ""}
                  </div>
                  <div className="mt-1 font-semibold capitalize">{id}</div>
                  {out && <VisualOutput id={id} output={out} exceptionId={row.exception_id} />}
                  {!out && <p className="mt-2 text-xs text-muted">Waiting</p>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function VisualOutput({ id, output, exceptionId }: { id: string; output: Record<string, unknown>; exceptionId?: string }) {
  const conf = output.confidence != null && output.confidence !== "" ? normalizeConfidence(output.confidence) : null;
  return (
    <div className="mt-3 space-y-2 text-xs text-slate-600">
      {output.verification === "unverified" && id !== "auditor" && (
        <p className="text-warning">Unverified output — not grounded in the SQL facts. Routed to the review queue.</p>
      )}
      {id === "investigator" && (
        <>
          <div className="text-sm text-ink">{String(output.root_cause || output.summary || "")}</div>
          {conf != null && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>Confidence</span>
                <span>{conf}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-accent" style={{ width: `${conf}%` }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {Array.isArray(output.evidence) &&
              output.evidence.map((e) => (
                <span key={String(e)} className="rounded bg-white/10 px-2 py-0.5">
                  {String(e)}
                </span>
              ))}
          </div>
        </>
      )}
      {id === "action" && Array.isArray(output.actions) && (
        <ul className="space-y-1">
          {output.actions.map((a, i) => {
            const row = a as Record<string, unknown>;
            return (
              <li key={i}>
                <span className="font-semibold uppercase text-cyan-300">{String(row.action ?? row.type ?? "act")}</span>
                {row.amount != null ? <span className="ml-2 text-danger">{inr(normalizeAmount(row.amount), true)}</span> : null}
                {row.rationale ? <div className="text-muted">{String(row.rationale)}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
      {id === "auditor" && (
        <>
          {(() => {
            const status = String(output.signoff ?? output.status ?? "");
            if (!status) return null;
            const badge = <SeverityBadge value={status} />;
            if (status === "needs_review" && exceptionId) {
              return (
                <Link to={`/review/${encodeURIComponent(exceptionId)}`} className="inline-flex" title="Open human review">
                  {badge}
                </Link>
              );
            }
            return badge;
          })()}
          {output.verification === "unverified" && (
            <p className="text-xs text-warning">Unverified — grounding check failed. Do not treat as fact.{exceptionId ? " " : ""}{exceptionId ? <Link to={`/review/${encodeURIComponent(exceptionId)}`} className="underline">Open review</Link> : null}</p>
          )}
          {typeof output.cfo_one_liner === "string" && <p className="text-sm text-white">{output.cfo_one_liner}</p>}
        </>
      )}
    </div>
  );
}
