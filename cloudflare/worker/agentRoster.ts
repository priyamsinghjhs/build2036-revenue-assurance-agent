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
  | "recon_billing"
  | "recon_invoicing"
  | "recon_cash"
  | "recon_vendor"
  | "recon_gl"
  | "recon_settlement"
  | "recon_funding"
  | "recon_acquirer"
  | "recon_config"
  | "recon_tax"
  | "recon_kyc"
  | "recon_interfaces"
  | "recon_aml"
  | "recon_network"
  | "recon_success"
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
  { id: "recon_billing", name: "Billing Recon", role: "Interprets contract vs rated billing and unbilled usage", kind: "reconciliation", domain: "billing" },
  { id: "recon_invoicing", name: "Invoicing Recon", role: "Interprets billing vs invoices, credit notes and tax lines", kind: "reconciliation", domain: "invoicing" },
  { id: "recon_cash", name: "Cash / AR Recon", role: "Interprets invoice vs cash, short-pays and unapplied cash", kind: "reconciliation", domain: "cash_ar" },
  { id: "recon_vendor", name: "Vendor Cost Recon", role: "Interprets vendor invoices vs expected and payments", kind: "reconciliation", domain: "vendor" },
  { id: "recon_gl", name: "GL / ERP Recon", role: "Interprets subledger vs journal entries", kind: "reconciliation", domain: "gl" },
  { id: "recon_settlement", name: "Settlement agent", role: "Interprets capture inclusion, fee deduction vs contract, and batch net vs calculation", kind: "reconciliation", domain: "settlement" },
  { id: "recon_funding", name: "Funding agent", role: "Interprets net settlement vs funded amount, SLA, failed/returned/held and wrong-account transfers", kind: "reconciliation", domain: "funding" },
  { id: "recon_acquirer", name: "Acquirer agent", role: "Interprets acquirer fees, interchange++ pass-through, settlement timing and bank-statement recon", kind: "reconciliation", domain: "acquirer" },
  { id: "recon_config", name: "Config change agent", role: "Interprets unapproved pricing and fee changes and their revenue impact", kind: "reconciliation", domain: "config" },
  { id: "recon_tax", name: "Tax & regulatory agent", role: "Interprets GST, TDS, illustrative zero-MDR and daily-cap exceptions", kind: "reconciliation", domain: "tax" },
  { id: "recon_kyc", name: "KYC agent", role: "Interprets expired or pending KYC, MCC mismatch, limits and hierarchy commission", kind: "reconciliation", domain: "kyc" },
  { id: "recon_interfaces", name: "Interface monitoring agent", role: "Interprets hop-count drops, duplicates and latency from pre-aggregated daily funnels", kind: "reconciliation", domain: "interfaces" },
  { id: "recon_aml", name: "AML / fraud agent", role: "Interprets rule-based structuring, refund abuse, round-trip, velocity and dormant-burst flags", kind: "reconciliation", domain: "aml" },
  { id: "recon_network", name: "Network risk agent", role: "Interprets graph scores: shared accounts or devices, cycles, known-bad proximity, changed accounts", kind: "reconciliation", domain: "network_risk" },
  { id: "recon_success", name: "Success-rate agent", role: "Interprets approval and decline patterns by channel, acquirer, APM and EMI", kind: "reconciliation", domain: "success" },
  { id: "gap_detection", name: "Gap / Leakage Detection", role: "Prioritises leakage themes across domains", kind: "gap" },
  { id: "investigator", name: "Investigator / Root-cause", role: "Explains why the top gaps exist", kind: "investigate" },
  { id: "action", name: "Action / Recommendation", role: "Proposes dispute, recover, re-bill or escalate with amounts", kind: "action" },
  { id: "auditor", name: "Auditor / Compliance", role: "Checks completeness, policy fit, and sign-off", kind: "audit" },
];

const ON_DEMAND_RECON: AgentId[] = [
  "recon_config","recon_tax","recon_kyc","recon_interfaces","recon_aml","recon_network","recon_success",
];
/** Full roster minus on-demand governance/risk recon agents, to stay within the free neuron budget.
 *  Run those domains individually (orchestrator + one recon + gap + investigator + action + auditor). */
export const RUN_ALL_SEQUENCE: AgentId[] = AGENT_ROSTER.map((a) => a.id).filter((id) => !ON_DEMAND_RECON.includes(id));

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
  { source: "orchestrator", target: "recon_billing" },
  { source: "orchestrator", target: "recon_invoicing" },
  { source: "orchestrator", target: "recon_cash" },
  { source: "orchestrator", target: "recon_vendor" },
  { source: "orchestrator", target: "recon_gl" },
  { source: "orchestrator", target: "recon_settlement" },
  { source: "orchestrator", target: "recon_funding" },
  { source: "orchestrator", target: "recon_acquirer" },
  { source: "orchestrator", target: "recon_config" },
  { source: "orchestrator", target: "recon_tax" },
  { source: "orchestrator", target: "recon_kyc" },
  { source: "orchestrator", target: "recon_interfaces" },
  { source: "orchestrator", target: "recon_aml" },
  { source: "orchestrator", target: "recon_network" },
  { source: "orchestrator", target: "recon_success" },
  { source: "recon_authorization", target: "gap_detection" },
  { source: "recon_scheme", target: "gap_detection" },
  { source: "recon_network_gateway", target: "gap_detection" },
  { source: "recon_partner", target: "gap_detection" },
  { source: "recon_terminal", target: "gap_detection" },
  { source: "recon_bank", target: "gap_detection" },
  { source: "recon_apm", target: "gap_detection" },
  { source: "recon_fx", target: "gap_detection" },
  { source: "recon_billing", target: "gap_detection" },
  { source: "recon_invoicing", target: "gap_detection" },
  { source: "recon_cash", target: "gap_detection" },
  { source: "recon_vendor", target: "gap_detection" },
  { source: "recon_gl", target: "gap_detection" },
  { source: "recon_settlement", target: "gap_detection" },
  { source: "recon_funding", target: "gap_detection" },
  { source: "recon_acquirer", target: "gap_detection" },
  { source: "recon_config", target: "gap_detection" },
  { source: "recon_tax", target: "gap_detection" },
  { source: "recon_kyc", target: "gap_detection" },
  { source: "recon_interfaces", target: "gap_detection" },
  { source: "recon_aml", target: "gap_detection" },
  { source: "recon_network", target: "gap_detection" },
  { source: "recon_success", target: "gap_detection" },
  { source: "gap_detection", target: "investigator" },
  { source: "investigator", target: "action" },
  { source: "action", target: "auditor" },
];
