export type SettlementListRow = {
  settlement_id: string;
  expected_amount: number;
  settled_amount: number;
  status: string;
};

export type InvestigationResult = {
  settlement_id: string;
  settlement_data?: string;
  anomaly_result?: string;
  related_data?: string;
  policy_context?: string;
  investigation?: string;
  evidence?: string;
  recommendation?: string;
  cfo_summary?: string;
  audit_trail: string[];
};

export const AGENT_STEPS = [
  { id: "anomaly", label: "Anomaly Detector", path: "/api/agents/anomaly" },
  { id: "investigate", label: "Investigator", path: "/api/agents/investigate" },
  { id: "evidence", label: "Evidence Synthesizer", path: "/api/agents/evidence" },
  { id: "recommend", label: "Recommendation Agent", path: "/api/agents/recommend" },
  { id: "audit", label: "Auditor / Explainer", path: "/api/agents/audit" },
] as const;

export type TabId =
  | "CFO Summary"
  | "Recommendation"
  | "Evidence"
  | "Investigation"
  | "Audit Trail";

export const RESULT_TABS: TabId[] = [
  "CFO Summary",
  "Recommendation",
  "Evidence",
  "Investigation",
  "Audit Trail",
];
