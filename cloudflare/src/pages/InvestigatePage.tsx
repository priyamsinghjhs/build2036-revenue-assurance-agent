import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/auth";
import { Play, RefreshCw } from "lucide-react";
import { api, type ExceptionRow, type SuggestionDecision } from "@/api";
import { AuditPanel } from "@/components/AuditPanel";
import { ExceptionTable } from "@/components/ExceptionTable";
import { SeverityBadge } from "@/components/SeverityBadge";
import { inr, prettyCat } from "@/lib/format";
import { inrExact } from "../../shared/money";
import { publicErrorMessage } from "../../shared/errors";
import { normalizeAmount, normalizeConfidence } from "../../shared/numbers";

const STEPS = ["investigator", "action", "auditor"] as const;
type StepId = (typeof STEPS)[number];


async function consumeInvestigateSse(
  body: Record<string, unknown>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<boolean> {
  const res = await fetch("/api/agents/investigate", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !res.body || !ct.includes("text/event-stream")) return false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      let ev = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      onEvent(ev, JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
    }
  }
  return true;
}

function stepComplete(id: StepId, out?: Record<string, unknown>) {
  if (!out) return false;
  if (id === "auditor") return Array.isArray(out.checks) && (out.checks as unknown[]).length === 6;
  if (id === "action") return Array.isArray(out.actions);
  return Boolean(out.root_cause || out.summary);
}

export default function InvestigatePage() {
  const { can } = useAuth();
  const canRun = can("recon_run");
  const { exceptionId } = useParams();
  const [row, setRow] = useState<ExceptionRow | null>(null);
  const [pool, setPool] = useState<ExceptionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<string>("");
  const [failedStep, setFailedStep] = useState<string>("");
  const [runId, setRunId] = useState("");
  const [outputs, setOutputs] = useState<Record<string, Record<string, unknown>>>({});
  const [decisions, setDecisions] = useState<SuggestionDecision[]>([]);

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
    setError("");
    setFailedStep("");
    setStep("");
    setRunId("");
    setOutputs({});
    api
      .exception(exceptionId)
      .then((r) => setRow(r.exception))
      .catch((e) => setError(publicErrorMessage(e, "Couldn't load this exception. Please try another.")));
    api.evidence(exceptionId).catch(() => undefined);
    api
      .latest(`exception:${exceptionId}`)
      .then((r) => {
        const latest = r.latest as { run?: { run_id?: string; status?: string }; outputs?: { agent_id: string; output: unknown }[] } | null;
        const next: Record<string, Record<string, unknown>> = {};
        for (const o of latest?.outputs ?? []) {
          const out = o.output;
          if (out && typeof out === "object") next[o.agent_id] = out as Record<string, unknown>;
        }
        setOutputs(next);
        const id = latest?.run?.run_id;
        if (id) setRunId(id);
      })
      .catch(() => undefined);
    api.suggestionDecisions(exceptionId).then((r) => setDecisions(r.decisions ?? [])).catch(() => undefined);
  }, [exceptionId]);

  async function run(resume: boolean) {
    if (!row) return;
    setBusy(true);
    setError("");
    setFailedStep("");
    let current = "";
    try {
      const next: Record<string, Record<string, unknown>> = resume ? { ...outputs } : {};
      if (!resume) setOutputs({});
      let id = resume ? runId : "";
      const canStream = !resume || !STEPS.some((s) => stepComplete(s, next[s]));
      if (canStream) {
        let streamFailed = "";
        const streamed = await consumeInvestigateSse(
          {
            exception_id: row.exception_id,
            domain: row.area,
            run_id: id || undefined,
          },
          (event, data) => {
            if (event === "step") {
              const agentId = String(data.agent_id) as StepId;
              current = agentId;
              setStep(agentId);
              next[agentId] = (data.output ?? {}) as Record<string, unknown>;
              setOutputs({ ...next });
            } else if (event === "done") {
              const rid = String(data.run_id ?? id);
              id = rid;
              setRunId(rid);
            } else if (event === "error") {
              streamFailed = String(data.message ?? "The investigation could not be completed.");
            }
          },
        );
        if (streamed) {
          if (streamFailed) throw new Error(streamFailed);
          if (!stepComplete("auditor", next.auditor)) {
            throw new Error("The auditor returned an incomplete result. You can retry this step.");
          }
          setStep("");
          return;
        }
      }
      if (!id) {
        const started = await api.startRun({ scope: `exception:${row.exception_id}`, domain: row.area });
        id = started.run_id;
        setRunId(id);
      }
      for (const agentId of STEPS) {
        if (resume && stepComplete(agentId, next[agentId])) continue;
        current = agentId;
        setStep(agentId);
        const res = await api.step({
          run_id: id,
          agent_id: agentId,
          scope: `exception:${row.exception_id}`,
          domain: row.area,
          exception_id: row.exception_id,
        });
        next[agentId] = (res.output ?? {}) as Record<string, unknown>;
        setOutputs({ ...next });
        if (agentId === "auditor" && !stepComplete(agentId, next[agentId])) {
          throw new Error("The auditor returned an incomplete result. You can retry this step.");
        }
      }
      await api.complete(id);
      setStep("");
    } catch (e) {
      setFailedStep(current);
      setStep("");
      setError(publicErrorMessage(e, "The investigation could not be completed. You can retry the remaining step."));
    } finally {
      setBusy(false);
    }
  }

  const hasDone = STEPS.some((id) => stepComplete(id, outputs[id]));
  const allDone = STEPS.every((id) => stepComplete(id, outputs[id]));
  const canResume = Boolean(runId) && hasDone && !allDone;
  const showRetry = Boolean(error) || canResume;

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
            {canRun ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(showRetry)}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
              >
                {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {busy ? `Running ${step}…` : showRetry ? "Retry remaining" : "Run investigation"}
              </button>
              {showRetry && !busy && (
                <button
                  type="button"
                  onClick={() => void run(false)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
                >
                  Run from the start
                </button>
              )}
            </div>
            ) : (
              <p className="mt-4 text-sm text-muted">This role can view the investigation but cannot start a new run.</p>
            )}
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </div>

          <ol className="grid gap-3 md:grid-cols-3">
            {STEPS.map((id, i) => {
              const out = outputs[id];
              const active = busy && step === id;
              const failed = !busy && failedStep === id;
              const done = stepComplete(id, out);
              return (
                <li key={id} className="rounded-xl border border-line bg-white p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted">
                    Step {i + 1} {active ? "· running" : failed ? "· failed" : done ? "· done" : ""}
                  </div>
                  <div className="mt-1 font-semibold capitalize">{id}</div>
                  {out && <VisualOutput id={id} output={out} />}
                  {failed && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-danger">This step did not finish. Retry to continue from here.</p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(true)}
                        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry this step
                      </button>
                    </div>
                  )}
                  {!out && !active && !failed && <p className="mt-2 text-xs text-muted">Waiting</p>}
                </li>
              );
            })}
          </ol>
          {outputs.auditor && stepComplete("auditor", outputs.auditor) && (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">Auditor review</h2>
              <AuditPanel
                output={outputs.auditor}
                exceptionId={row.exception_id}
                decisions={decisions}
                onDecided={() => {
                  api.suggestionDecisions(row.exception_id).then((r) => setDecisions(r.decisions ?? [])).catch(() => undefined);
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function VisualOutput({ id, output }: { id: string; output: Record<string, unknown> }) {
  const conf = output.confidence != null && output.confidence !== "" ? normalizeConfidence(output.confidence) : null;
  return (
    <div className="mt-3 space-y-2 text-xs text-slate-600">
      {output.verification === "unverified" && id !== "auditor" && (
        <p className="text-warning">Unverified output — not grounded in the SQL facts. Routed to the review queue.</p>
      )}
      {id === "investigator" && (
        <>
          <div className="text-sm text-ink">{String(output.root_cause || output.summary || "")}</div>
          {typeof output.hypothesis === "string" && output.hypothesis ? (
            <p className="text-xs text-warning">{String(output.hypothesis)}</p>
          ) : null}
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
                {row.amount != null ? <span className="ml-2 text-danger">{inrExact(normalizeAmount(row.amount))}</span> : null}
                {row.rationale ? <div className="text-muted">{String(row.rationale)}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
      {id === "auditor" && (
        <div className="space-y-1" data-testid="auditor-step-summary">
          {typeof output.cfo_one_liner === "string" && output.cfo_one_liner ? (
            <p className="text-sm text-ink">{output.cfo_one_liner}</p>
          ) : (
            <p className="text-sm text-ink">Auditor step complete. See the review panel below.</p>
          )}
        </div>
      )}
    </div>
  );
}
