export type AgentId =
  | "orchestrator"
  | "recon_authorization"
  | "recon_scheme"
  | "recon_network_gateway"
  | "recon_partner"
  | "recon_terminal"
  | "recon_bank"
  | "recon_apm"
  | "recon_fx"
  | "gap_detection"
  | "investigator"
  | "action"
  | "auditor";

export const AGENT_ROSTER: {
  id: AgentId;
  name: string;
  role: string;
  kind: "orchestrator" | "reconciliation" | "gap" | "investigate" | "action" | "audit";
  domain?: string;
}[] = [
  { id: "orchestrator", name: "Orchestrator", role: "Routes work, sets domain priority, sequences handoffs", kind: "orchestrator" },
  { id: "recon_authorization", name: "Auth / Capture Recon", role: "Interprets auth↔capture SQL results", kind: "reconciliation", domain: "authorization" },
  { id: "recon_scheme", name: "Scheme Settlement Recon", role: "Interprets scheme settlement and fee SQL results", kind: "reconciliation", domain: "scheme" },
  { id: "recon_network_gateway", name: "Network & Gateway Recon", role: "Interprets network and gateway fee invoices vs expected", kind: "reconciliation", domain: "fees" },
  { id: "recon_partner", name: "Partner Fee Recon", role: "Interprets ISO / referral / platform share invoices", kind: "reconciliation", domain: "partner" },
  { id: "recon_terminal", name: "POS Terminal Recon", role: "Interprets rental billing vs terminal inventory", kind: "reconciliation", domain: "terminal" },
  { id: "recon_bank", name: "TRS Bank Recon", role: "Interprets treasury bank statement vs scheme net", kind: "reconciliation", domain: "bank_trs" },
  { id: "recon_apm", name: "APM Recon", role: "Interprets UPI / wallet / BNPL / A2A provider reports", kind: "reconciliation", domain: "apm" },
  { id: "recon_fx", name: "FX Recon", role: "Interprets applied FX vs reference rate and markup cap", kind: "reconciliation", domain: "fx" },
  { id: "gap_detection", name: "Gap / Leakage Detection", role: "Prioritises leakage themes across domains", kind: "gap" },
  { id: "investigator", name: "Investigator / Root-cause", role: "Explains why the top gaps exist", kind: "investigate" },
  { id: "action", name: "Action / Recommendation", role: "Proposes dispute, recover, re-bill or escalate with amounts", kind: "action" },
  { id: "auditor", name: "Auditor / Compliance", role: "Checks completeness, policy fit, and sign-off", kind: "audit" },
];

export const RUN_ALL_SEQUENCE: AgentId[] = AGENT_ROSTER.map((a) => a.id);

export function sequenceForDomain(domain: string): AgentId[] {
  const recon = AGENT_ROSTER.find((a) => a.kind === "reconciliation" && a.domain === domain);
  const list: AgentId[] = ["orchestrator"];
  if (recon) list.push(recon.id);
  list.push("gap_detection", "investigator", "action", "auditor");
  return list;
}

export const AGENT_GRAPH_EDGES: { source: AgentId; target: AgentId }[] = [
  { source: "orchestrator", target: "recon_authorization" },
  { source: "orchestrator", target: "recon_scheme" },
  { source: "orchestrator", target: "recon_network_gateway" },
  { source: "orchestrator", target: "recon_partner" },
  { source: "orchestrator", target: "recon_terminal" },
  { source: "orchestrator", target: "recon_bank" },
  { source: "orchestrator", target: "recon_apm" },
  { source: "orchestrator", target: "recon_fx" },
  { source: "recon_authorization", target: "gap_detection" },
  { source: "recon_scheme", target: "gap_detection" },
  { source: "recon_network_gateway", target: "gap_detection" },
  { source: "recon_partner", target: "gap_detection" },
  { source: "recon_terminal", target: "gap_detection" },
  { source: "recon_bank", target: "gap_detection" },
  { source: "recon_apm", target: "gap_detection" },
  { source: "recon_fx", target: "gap_detection" },
  { source: "gap_detection", target: "investigator" },
  { source: "investigator", target: "action" },
  { source: "action", target: "auditor" },
];
