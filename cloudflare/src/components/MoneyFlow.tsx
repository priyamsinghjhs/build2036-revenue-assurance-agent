import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { inr } from "../lib/format";

export function MoneyFlow({
  flow,
}: {
  flow: {
    capture: number;
    gateway_fees: number;
    scheme_gross: number;
    scheme_net: number;
    bank: number;
    payout: number;
    leakage_by_area: Record<string, number>;
  };
}) {
  const leak = (k: string) => flow.leakage_by_area[k] ?? 0;
  const nodes: Node[] = useMemo(
    () => [
      n("merchant", "Merchants", flow.capture, 0, 80),
      n("gateway", "Gateway", flow.capture - flow.gateway_fees, 180, 20),
      n("scheme", "Schemes", flow.scheme_net, 360, 80),
      n("bank", "Bank / TRS", flow.bank, 540, 20),
      n("payout", "Payouts", flow.payout, 720, 80),
      leakN("l1", "Auth / capture leak", leak("authorization"), 180, 200),
      leakN("l2", "Scheme / fee leak", leak("scheme") + leak("gateway") + leak("network"), 360, 200),
      leakN("l3", "Bank / TRS leak", leak("bank_trs"), 540, 200),
      leakN("l4", "Payout leak", leak("payouts") + leak("pricing") + leak("chargebacks"), 720, 200),
    ],
    [flow],
  );
  const edges: Edge[] = useMemo(
    () => [
      e("merchant", "gateway", flow.capture, false),
      e("gateway", "scheme", flow.scheme_gross, false),
      e("scheme", "bank", flow.scheme_net, false),
      e("bank", "payout", flow.payout, false),
      e("merchant", "l1", leak("authorization"), true),
      e("gateway", "l2", leak("scheme") + leak("gateway") + leak("network"), true),
      e("scheme", "l3", leak("bank_trs"), true),
      e("bank", "l4", leak("payouts") + leak("pricing") + leak("chargebacks"), true),
    ],
    [flow],
  );
  return (
    <div className="h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c1220]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        panOnDrag
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function n(id: string, label: string, value: number, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    data: { label: `${label}\n${inr(value, true)}` },
    style: {
      background: "#152033",
      color: "#e5eef7",
      border: "1px solid #334155",
      borderRadius: 12,
      padding: 8,
      width: 140,
      whiteSpace: "pre-line",
      fontSize: 11,
      fontWeight: 600,
    },
  };
}

function leakN(id: string, label: string, value: number, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    data: { label: `${label}\n${inr(value, true)}` },
    style: {
      background: "#3f1219",
      color: "#fda4af",
      border: "1px solid #fb7185",
      borderRadius: 12,
      padding: 8,
      width: 150,
      whiteSpace: "pre-line",
      fontSize: 11,
      fontWeight: 600,
    },
  };
}

function e(source: string, target: string, value: number, leak: boolean): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label: inr(value, true),
    style: { stroke: leak ? "#fb7185" : "#22d3ee", strokeWidth: leak ? 2 : 2.5 },
    labelStyle: { fill: leak ? "#fda4af" : "#cbd5e1", fontSize: 10 },
    markerEnd: { type: MarkerType.ArrowClosed, color: leak ? "#fb7185" : "#22d3ee" },
  };
}
