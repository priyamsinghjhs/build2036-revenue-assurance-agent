import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Play, RefreshCw } from "lucide-react";
import { api, type ActionRow, type AutomationLog, type LatestRun, type Roster } from "@/api";
import { SeverityBadge, StatusDot } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { inr, prettyCat } from "@/lib/format";
import { publicErrorMessage } from "../../shared/errors";

const DOMAINS = [
  { id: "all", label: "Run all" },
  { id: "authorization", label: "Auth / Capture" },
  { id: "scheme", label: "Scheme" },
  { id: "fees", label: "Network & Gateway" },
  { id: "partner", label: "Partner fees" },
  { id: "terminal", label: "POS terminals" },
  { id: "bank_trs", label: "TRS bank" },
  { id: "apm", label: "APM" },
  { id: "fx", label: "FX" },
  { id: "billing", label: "Billing" },
  { id: "invoicing", label: "Invoicing" },
  { id: "cash_ar", label: "Cash / AR" },
  { id: "vendor", label: "Vendor costs" },
  { id: "gl", label: "GL / ERP" },
  { id: "settlement", label: "Settlement" },
  { id: "funding", label: "Funding" },
  { id: "acquirer", label: "Acquirer" },
  { id: "config", label: "Config changes" },
  { id: "tax", label: "Tax & regulatory" },
  { id: "kyc", label: "KYC" },
  { id: "interfaces", label: "Interfaces" },
  { id: "aml", label: "AML / fraud" },
  { id: "network_risk", label: "Network risk" },
  { id: "success", label: "Success rate" },
];

type StepStatus = "idle" | "running" | "done" | "cached" | "error";

export default function AgentsPage() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [latest, setLatest] = useState<LatestRun | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [status, setStatus] = useState<Record<string, StepStatus>>({});
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [active, setActive] = useState<string>("orchestrator");
  const [domain, setDomain] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoLog, setAutoLog] = useState<AutomationLog | null>(null);

  const loadCached = useCallback(async (scope: string) => {
    const [{ latest: cached }, act] = await Promise.all([api.latest(scope), api.actions()]);
    setActions(act.actions);
    if (cached) {
      setLatest(cached);
      const map: Record<string, unknown> = {};
      const st: Record<string, StepStatus> = {};
      for (const o of cached.outputs) {
        map[o.agent_id] = o.output;
        st[o.agent_id] = "cached";
      }
      setOutputs(map);
      setStatus(st);
      if (cached.outputs[0]) setActive(cached.outputs[0].agent_id);
    }
  }, []);

  useEffect(() => {
    api
      .roster()
      .then(setRoster)
      .catch((e) => setError(publicErrorMessage(e, "Couldn't load agents. Please refresh.")));
    loadCached("all").catch(() => undefined);
    api.automationLatest().then((r) => setAutoLog(r.latest)).catch(() => undefined);
  }, [loadCached]);

  async function runNow() {
    setAutoBusy(true);
    setError("");
    try {
      await api.runAutomation();
      const [{ latest: cached }, act, auto] = await Promise.all([
        api.latest("automation:manual"),
        api.actions(),
        api.automationLatest(),
      ]);
      setLatest(cached);
      setActions(act.actions);
      setAutoLog(auto.latest);
    } catch (e) {
      setError(publicErrorMessage(e));
    } finally {
      setAutoBusy(false);
    }
  }

  async function decide(id: string, status: "approved" | "rejected" | "done") {
    await api.decideAction(id, status);
    const act = await api.actions();
    setActions(act.actions);
  }

  async function runPipeline() {
    if (!roster) return;
    setBusy(true);
    setError("");
    try {
      const started = await api.startRun({ scope: domain, domain: domain === "all" ? undefined : domain });
      setRunId(started.run_id);
      const nextStatus: Record<string, StepStatus> = {};
      const nextOut: Record<string, unknown> = {};
      for (const id of started.sequence) nextStatus[id] = "idle";
      setStatus({ ...nextStatus });
      setOutputs({});
      for (const agentId of started.sequence) {
        setActive(agentId);
        setStatus((s) => ({ ...s, [agentId]: "running" }));
        const step = await api.step({
          run_id: started.run_id,
          agent_id: agentId,
          scope: domain,
          domain: domain === "all" ? "" : domain,
        });
        nextOut[agentId] = step.output;
        setOutputs((o) => ({ ...o, [agentId]: step.output }));
        setStatus((s) => ({ ...s, [agentId]: "done" }));
      }
      await api.complete(started.run_id);
      const act = await api.actions();
      setActions(act.actions);
      setLatest({
        run: { run_id: started.run_id, status: "completed" },
        outputs: started.sequence.map((id) => ({
          agent_id: id,
          domain: domain === "all" ? null : domain,
          output: nextOut[id],
          created_at: new Date().toISOString(),
        })),
        actions: act.actions.filter((a) => a.run_id === started.run_id),
      });
    } catch (e) {
      setError(publicErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const nodes: Node[] = useMemo(() => {
    if (!roster) return [];
    const reconIndex = new Map(
      roster.agents.filter((x) => x.kind === "reconciliation").map((x, i) => [x.id, i]),
    );
    return roster.agents.map((a) => {
      let x = 0, y = 160;
      if (a.kind === "orchestrator") { x = 0; y = 160; }
      else if (a.kind === "reconciliation") {
        const i = reconIndex.get(a.id) ?? 0;
        x = 180 + (i % 5) * 140;
        y = 16 + Math.floor(i / 5) * 88;
      } else if (a.kind === "gap") { x = 920; y = 110; }
      else if (a.kind === "investigate") { x = 1080; y = 110; }
      else if (a.kind === "action") { x = 1240; y = 110; }
      else { x = 1400; y = 110; }
      const st = status[a.id] || "idle";
      const border =
        st === "running" ? "#1d4ed8" : st === "error" ? "#b91c1c" : st === "done" || st === "cached" ? "#047857" : "#e2e8f0";
      return {
        id: a.id,
        position: { x, y },
        data: { label: a.name },
        style: {
          background: active === a.id ? "#eff6ff" : "#ffffff",
          color: "#0f172a",
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: 6,
          width: 150,
          fontSize: 11,
          fontWeight: 600,
        },
      } satisfies Node;
    });
  }, [roster, status, active]);

  const edges: Edge[] = useMemo(() => {
    if (!roster) return [];
    return roster.edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: { stroke: "#64748b" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
    }));
  }, [roster]);

  const selected = outputs[active] as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Agents &amp; actions</h1>
          <p className="text-sm text-muted">Daily cron runs recon, investigates the top exception, and queues actions. Approve or reject below.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={autoBusy || busy} onClick={runNow}>
            {autoBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {autoBusy ? "Running…" : "Run now"}
          </Button>
          <select
            className="h-9 rounded-lg border border-line bg-white px-2 text-sm"
            value={domain}
            disabled={busy || autoBusy}
            onChange={(e) => setDomain(e.target.value)}
            aria-label="Advanced pipeline domain"
          >
            {DOMAINS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <Button variant="outline" disabled={busy || autoBusy} onClick={runPipeline}>
            {busy ? "Running…" : "Advanced pipeline"}
          </Button>
        </div>
      </header>
      {error && <p className="text-sm text-danger">{error}</p>}
      {autoLog && (
        <p className="text-xs text-muted">
          Last automatic run: {String(autoLog.status)} at {new Date(autoLog.started_at).toLocaleString("en-IN", { timeZone: "Asia/Calcutta" })} IST
        </p>
      )}
      {runId && <p className="text-[11px] text-muted">Run {runId}</p>}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Roster</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(roster?.agents || []).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActive(a.id)}
              className={`rounded-xl border p-3 text-left transition ${
                active === a.id ? "border-accent bg-slate-50" : "border-line bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{a.name}</span>
                <span className="flex items-center gap-1 text-[11px] uppercase text-muted">
                  <StatusDot status={status[a.id] || "idle"} />
                  {status[a.id] || "idle"}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{a.role}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Pipeline</h2>
        <div className="h-[260px] overflow-hidden rounded-xl border border-line bg-white sm:h-[340px]">
          <ReactFlow nodes={nodes} edges={edges} fitView panOnDrag zoomOnScroll={false} proOptions={{ hideAttribution: true }}>
            <Background color="#e2e8f0" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Agent output</h2>
          <AgentOutput output={selected} />
          {!selected && <p className="text-sm text-muted">Run a pipeline or pick a cached agent.</p>}
        </section>
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Action queue</h2>
          <ActionQueue rows={actions} onDecide={decide} />
        </section>
      </div>
      {latest?.run && (
        <p className="text-[11px] text-muted">Cached run status: {String(latest.run.status ?? "known")}</p>
      )}
    </div>
  );
}

function AgentOutput({ output }: { output?: Record<string, unknown> }) {
  if (!output) return null;
  const chips = [
    output.risk_level,
    output.match_quality,
    output.assessment,
    output.signoff,
    output.root_cause,
  ].filter((v) => typeof v === "string") as string[];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <SeverityBadge key={c} value={c} />
        ))}
        {typeof output.confidence === "number" && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-accent">
            {(Number(output.confidence) * 100).toFixed(0)}% confidence
          </span>
        )}
      </div>
      {typeof output.cfo_one_liner === "string" && <p className="text-ink">{output.cfo_one_liner}</p>}
      {typeof output.summary === "string" && <p className="text-ink">{output.summary}</p>}
      <KeyList title="Attention" items={asList(output.attention)} />
      <KeyList title="Themes" items={asList(output.themes)} />
      <KeyList title="Evidence" items={asList(output.evidence)} />
      <KeyList title="Priority domains" items={asList(output.priority_domains)} />
      <GapList items={output.top_gaps} />
      <GapList items={output.priority_gaps} />
      <ActionList items={output.actions} />
    </div>
  );
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function KeyList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((i) => (
          <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs capitalize text-ink">
            {prettyCat(i)}
          </span>
        ))}
      </div>
    </div>
  );
}

function GapList({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className="space-y-1 text-xs text-ink">
      {items.map((g, i) => {
        const row = g as Record<string, unknown>;
        return (
          <li key={i} className="rounded-lg bg-slate-50 px-2 py-1">
            {String(row.category || row.area || "gap")}
            {row.leakage != null ? ` · ${inr(Number(row.leakage), true)}` : ""}
            {row.why ? ` — ${row.why}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

function ActionList({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {items.map((a, i) => {
        const row = a as Record<string, unknown>;
        return (
          <li key={i} className="rounded-lg border border-line px-2 py-1">
            <span className="font-semibold uppercase text-accent">{String(row.action ?? row.type ?? "act")}</span>
            {row.amount != null ? <span className="ml-2 text-danger">{inr(Number(row.amount), true)}</span> : null}
            {row.rationale ? <div className="text-muted">{String(row.rationale)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ActionQueue({ rows, onDecide }: { rows: ActionRow[]; onDecide: (id: string, status: "approved" | "rejected" | "done") => void }) {
  if (!rows.length) return <p className="text-sm text-muted">No queued actions yet. Run now to seed recommendations.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1">Action</th>
            <th className="py-1">Amount</th>
            <th className="py-1">Status</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.action_id} className="border-t border-line">
              <td className="py-1.5">
                <div className="font-semibold uppercase text-accent">{r.action}</div>
                <div className="line-clamp-2 text-muted">{r.rationale}</div>
                {r.exception_id && <div className="text-[11px] text-muted">{r.exception_id}</div>}
              </td>
              <td className="py-1.5 tabular-nums text-danger">{inr(r.amount, true)}</td>
              <td className="py-1.5 capitalize">{r.status}</td>
              <td className="py-1.5 text-right">
                {r.status === "proposed" && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="success" onClick={() => onDecide(r.action_id, "approved")}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => onDecide(r.action_id, "rejected")}>Reject</Button>
                  </div>
                )}
                {r.status === "approved" && (
                  <Button size="sm" variant="outline" onClick={() => onDecide(r.action_id, "done")}>Mark done</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
