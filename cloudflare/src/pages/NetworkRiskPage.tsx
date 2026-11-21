import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type Node,
  Position,
} from "@xyflow/react";
import { api, type NetworkRiskPayload } from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function riskColor(score: number, bad: boolean) {
  if (bad || score >= 80) return { bg: "#7f1d1d", border: "#b91c1c", text: "#fef2f2" };
  if (score >= 55) return { bg: "#7c2d12", border: "#c2410c", text: "#fff7ed" };
  if (score >= 30) return { bg: "#1e3a8a", border: "#1d4ed8", text: "#eff6ff" };
  return { bg: "#0f172a", border: "#334155", text: "#f8fafc" };
}

export default function NetworkRiskPage() {
  const [data, setData] = useState<NetworkRiskPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.networkRisk().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const visible = data.nodes.filter((n) => Number(n.risk_score) >= 20 || Number(n.is_known_bad) === 1 || n.kind === "merchant");
    const ids = new Set(visible.map((n) => n.id));
    const lanes: Record<string, number> = { merchant: 0, terminal: 1, device: 2, bank_account: 3, partner: 4, card: 5, entity: 6 };
    const counters: Record<string, number> = {};
    const nodes: Node[] = visible.map((n) => {
      const lane = lanes[String(n.kind)] ?? 7;
      counters[n.kind] = (counters[n.kind] ?? 0) + 1;
      const pal = riskColor(Number(n.risk_score), Number(n.is_known_bad) === 1);
      return {
        id: n.id,
        position: { x: lane * 220, y: counters[n.kind] * 72 },
        data: { label: `${n.label} (${Math.round(Number(n.risk_score))})` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: pal.bg,
          color: pal.text,
          border: `1px solid ${pal.border}`,
          borderRadius: 8,
          fontSize: 11,
          width: 180,
          padding: 6,
        },
      };
    });
    const edges: Edge[] = data.edges
      .filter((e) => ids.has(e.src) && ids.has(e.dst))
      .map((e) => ({
        id: e.id,
        source: e.src,
        target: e.dst,
        style: { stroke: "#94a3b8" },
      }));
    return { nodes, edges };
  }, [data]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading network graph…</p>;

  const hot = data.nodes.filter((n) => Number(n.risk_score) >= 55 || Number(n.is_known_bad) === 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Network risk</h1>
          <p className="text-sm text-muted">
            Merchants, terminals, devices, accounts, partners and cards scored in Postgres with recursive CTEs.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <a className="rounded-md border border-line px-2 py-1 hover:bg-slate-50" href="/api/network-risk/export?kind=nodes">Export nodes CSV</a>
          <a className="rounded-md border border-line px-2 py-1 hover:bg-slate-50" href="/api/network-risk/export?kind=edges">Export edges CSV</a>
        </div>
      </header>

      <p className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-muted">{data.note}</p>

      <Card>
        <CardHeader>
          <CardTitle>Entity graph</CardTitle>
          <CardDescription>Higher-risk and merchant nodes. Colour encodes risk score; crimson is known-bad or 80+. Edge relationship types are in the CSV export.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[480px] w-full overflow-hidden rounded-md border border-line" style={{ minHeight: 480 }}>
            <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.3} maxZoom={1.4} proOptions={{ hideAttribution: true }}>
              <Background gap={16} color="#e2e8f0" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>High-risk entities</CardTitle>
          <CardDescription>Shared devices or accounts, funding to a changed account, and proximity to known-bad cards.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 pr-3">Entity</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Merchant</th>
                <th className="pb-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {hot.map((n) => (
                <tr key={n.id} className="border-t border-line">
                  <td className="max-w-[240px] truncate py-2 pr-3" title={n.label}>{n.label}</td>
                  <td className="py-2 pr-3 capitalize text-muted">{n.kind.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3 text-muted">{n.merchant_id ?? "—"}</td>
                  <td className={cn("py-2 text-right tabular-nums", Number(n.is_known_bad) === 1 ? "text-danger font-semibold" : "text-ink")}>
                    {Math.round(Number(n.risk_score))}
                    {Number(n.is_known_bad) === 1 ? " · known-bad" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
