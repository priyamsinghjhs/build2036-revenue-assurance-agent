async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (!response.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err?.error || err?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  overview: () => request<Overview>("/api/dashboard/overview"),
  areas: () => request<{ areas: AreaMeta[] }>("/api/areas"),
  area: (id: string) => request<AreaDetail>(`/api/areas/${id}`),
  exception: (id: string) => request<{ exception: ExceptionRow }>(`/api/exceptions/${encodeURIComponent(id)}`),
  roster: () => request<Roster>("/api/agents/roster"),
  latest: (scope?: string) =>
    request<{ latest: LatestRun | null }>(`/api/agents/latest${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`),
  actions: () => request<{ actions: ActionRow[] }>("/api/actions"),
  startRun: (body: { scope: string; domain?: string }) =>
    request<{ run_id: string; sequence: string[] }>("/api/agents/runs", { method: "POST", body: JSON.stringify(body) }),
  step: (body: Record<string, string>) =>
    request<{ agent_id: string; output: unknown; created_at: string }>("/api/agents/step", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  complete: (run_id: string) =>
    request("/api/agents/complete", { method: "POST", body: JSON.stringify({ run_id }) }),
  systemMap: () => request<SystemMap>("/api/system-map"),
  executive: () => request<Executive>("/api/executive"),
  filters: () => request<FilterOptions>("/api/filters"),
  automationLatest: () => request<{ latest: AutomationLog | null }>("/api/automation/latest"),
  runAutomation: () =>
    request<Record<string, unknown>>("/api/automation/run", { method: "POST", body: "{}" }),
  decideAction: (id: string, status: "approved" | "rejected" | "done", note?: string) =>
    request("/api/actions/" + encodeURIComponent(id) + "/decision", {
      method: "POST",
      body: JSON.stringify({ status, note }),
    }),
  controls: () => request<ControlsPayload>("/api/controls"),
  trace: (q: string) => request<TraceResult>(`/api/trace?q=${encodeURIComponent(q)}`),
  networkRisk: () => request<NetworkRiskPayload>("/api/network-risk"),
  contracts: () => request<ContractsPayload>("/api/contracts"),
  contractDoc: (id: string) => request<DocumentDetail>(`/api/contracts/documents/${encodeURIComponent(id)}`),
  extractContract: (doc_id: string) =>
    request<Record<string, unknown>>("/api/contracts/extract", { method: "POST", body: JSON.stringify({ doc_id }) }),
  decideRule: (id: string, status: "approved" | "rejected") =>
    request("/api/contracts/rules/" + encodeURIComponent(id) + "/decision", {
      method: "POST",
      body: JSON.stringify({ status, reviewer: "Priyam Singh" }),
    }),
  anomalies: () => request<AnomalyPayload>("/api/anomalies"),
  investigateAnomaly: (event_id?: string) =>
    request<{ skipped?: boolean; event_id?: string; exception_id?: string; run_id?: string }>("/api/anomalies/investigate", {
      method: "POST",
      body: JSON.stringify(event_id ? { event_id } : {}),
    }),
  routing: () => request<RoutingPayload>("/api/routing"),
  simulateRouting: () => request<RoutingPayload>("/api/routing/simulate", { method: "POST", body: "{}" }),
  cases: async () => {
    const r = await request<{ cases: Record<string, unknown>[] }>("/api/cases");
    const now = Date.now();
    return (r.cases ?? []).map((c) => {
      const sla = c.sla_due ? Date.parse(String(c.sla_due)) : NaN;
      return {
        case_id: String(c.case_id),
        title: String(c.title ?? c.case_id),
        status: String(c.status ?? "new"),
        owner: c.owner == null ? null : String(c.owner),
        leakage: Number(c.leakage ?? 0),
        sla_due: c.sla_due == null ? null : String(c.sla_due),
        overdue: String(c.status) !== "resolved" && Number.isFinite(sla) && sla < now,
        cause_key: String(c.cause_key ?? ""),
        cause_label: String(c.cause_label ?? ""),
        exception_count: Number(c.exception_count ?? 0),
      } satisfies CaseListItem;
    });
  },
  caseDetail: (id: string) => request<Record<string, unknown>>(`/api/cases/${encodeURIComponent(id)}`),
  updateCase: (id: string, patch: { status?: string; comment?: string; owner?: string }) =>
    request(`/api/cases/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ ...patch, actor: "Priyam Singh" }) }),
  reviews: async () => {
    const r = await request<{ pending: Record<string, unknown>[]; decided: Record<string, unknown>[]; count: number }>("/api/reviews");
    const map = (row: Record<string, unknown>): ReviewListItem => {
      const action = parseJson(row.action_json);
      const amt = Number(action.amount ?? action.recommended_amount ?? 0);
      return {
        exception_id: String(row.exception_id),
        area: String(row.domain ?? ""),
        merchant_id: row.merchant_id == null ? null : String(row.merchant_id),
        review_status: String(row.review_status ?? "pending"),
        amount: Number.isFinite(amt) ? amt : 0,
        category: String(row.category ?? ""),
      };
    };
    return [...(r.pending ?? []), ...(r.decided ?? [])].map(map);
  },
  review: async (id: string): Promise<ReviewDetail> => {
    const r = await request<{ review: Record<string, unknown>; exception: Record<string, unknown> | null; case: Record<string, unknown> | null; suggestion_decisions?: SuggestionDecision[] }>(
      `/api/reviews/${encodeURIComponent(id)}`,
    );
    const rev = r.review ?? {};
    const ex = r.exception ?? {};
    const inv = parseJson(rev.investigator_json);
    const act = parseJson(rev.action_json);
    const aud = parseJson(rev.auditor_json);
    return {
      item: {
        exception_id: String(rev.exception_id ?? id),
        area: String(ex.area ?? rev.domain ?? ""),
        category: String(ex.category ?? ""),
        merchant_id: ex.merchant_id == null ? null : String(ex.merchant_id),
        description: String(ex.category ? `${ex.category} · ${ex.ref_id ?? ""}`.trim() : rev.exception_id ?? ""),
        amount: Number(ex.leakage ?? act.amount ?? 0),
        facts: ex,
        case_id: r.case?.case_id ? String(r.case.case_id) : null,
        auditor_status: String(aud.verdict ?? aud.signoff ?? aud.status ?? "needs_review"),
        review_status: String(rev.review_status ?? "pending"),
      },
      investigator: inv,
      action: act,
      auditor: aud,
      suggestion_decisions: r.suggestion_decisions ?? [],
    };
  },
  suggestionDecisions: (exceptionId: string) =>
    request<{ decisions: SuggestionDecision[] }>(`/api/audit/suggestions?exception_id=${encodeURIComponent(exceptionId)}`),
  decideSuggestion: (body: {
    exception_id: string;
    suggestion: AuditSuggestion;
    decision: "accepted" | "dismissed";
    comment?: string;
    run_id?: string;
  }) =>
    request<{ decision_id?: string; action_id?: string | null; draft_id?: string | null; already?: boolean; decision?: string }>(
      "/api/audit/suggestions",
      { method: "POST", body: JSON.stringify({ ...body, reviewer: "Priyam Singh" }) },
    ),
  submitReview: (
    id: string,
    body: { decision: "approved" | "rejected" | "reinvestigate"; comment: string; amount_override?: number },
  ) =>
    request(`/api/reviews/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ ...body, reviewer: "Priyam Singh" }),
    }),
  ask: (question: string) => request<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ question }) }),
  risks: () => request<{ risks: { risk_id: string; title: string; category: string; inherent: number; residual: number; owner: string; controls: number; findings: number; exposure: number }[]; gaps: { risk_id: string; title: string; inherent: number; residual: number; owner: string }[] }>("/api/risks"),
  ruleTests: (id: string) => request<{ rule_id: string; tests: RuleTest[]; passed?: boolean; sql_expression?: string; note?: string; error?: string }>(`/api/contracts/rules/${encodeURIComponent(id)}/tests`),
  runRuleTests: (id: string) =>
    request<{ rule_id: string; tests: RuleTest[]; passed: boolean; sql_expression: string; note?: string }>(`/api/contracts/rules/${encodeURIComponent(id)}/test`, { method: "POST", body: "{}" }),
  evalQuality: () => request<EvalQuality>("/api/eval/quality"),
  ingestion: () => request<IngestionPayload>("/api/ingestion"),
  parseIngestion: () => request<IngestionPayload>("/api/ingestion/parse", { method: "POST", body: "{}" }),
  files: async () => {
    const r = await request<{ summary: Record<string, unknown>[]; exceptions: Record<string, unknown>[] }>("/api/files");
    const exceptions = r.exceptions ?? [];
    return {
      files: exceptions.map((e) => ({
        source: String(e.scheme ?? e.method ?? ""),
        expected_day: String(e.ts ?? ""),
        exception_kind: String(e.category ?? ""),
        exposure: Number(e.leakage ?? 0),
        filename: String(e.recon_ref ?? ""),
      })),
      missing: exceptions.filter((e) => e.category === "file_missing").length,
      oos: exceptions.filter((e) => e.category === "file_out_of_sequence").length,
      exposure: exceptions.reduce((s, e) => s + Number(e.leakage ?? 0), 0),
    };
  },
};


export type FilterOptions = {
  period: { from: string; to: string; label: string };
  merchants: { merchant_id: string; name: string }[];
  schemes: string[];
};

export type AutomationLog = {
  log_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  detail: unknown;
};

export type Executive = {
  synthetic: boolean;
  period: { from: string; to: string; as_of: string; label: string };
  kpis: {
    revenue: number;
    leakage: number;
    leakage_pct: number;
    recovered: number;
    recoverable: number;
    written_off: number;
    match_rate: number;
    exception_count: number;
    auth_count: number;
    merchant_count: number;
  };
  ageing: { bucket: string; n: number; leakage: number }[];
  waterfall: { name: string; value: number; kind: "total" | "leak" | "net" }[];
  trend: { day: string; leakage: number; n: number }[];
  period_compare: { prior: number; current: number; delta: number };
  top_drivers: { area: string; category: string; n: number; leakage: number }[];
  heatmap: { area: string; label: string; match_rate: number; leakage: number; exceptions: number }[];
  funnel: { stage: string; amount: number; n: number }[];
  narrative: { bullets: string[]; source: string; generated_at: string | null } | null;
  governance: GovernanceKpis | null;
  intelligence: IntelligenceKpis | null;
};

export type GovernanceKpis = {
  controls_total: number;
  controls_pass: number;
  controls_fail: number;
  coverage_pct: number;
  unapproved_changes: number;
  unapproved_impact: number;
  tax_leakage: number;
  kyc_open: number;
  kyc_at_risk: number;
  aml_flags: number;
  aml_exposure: number;
  interface_drop_pct: number;
  success_rate: number;
};

export type IntelligenceKpis = {
  contracts_pending: number;
  contracts_approved: number;
  contract_leakage: number;
  anomaly_open: number;
  routing_uplift: number;
  routing_savings: number;
  cases_open: number;
  cases_overdue: number;
  files_missing: number;
  risks_total: number;
  risks_gap: number;
  reviews_pending: number;
  ai_faithfulness: number;
  ai_unverified: number;
};

export type ControlRow = {
  control_id: string;
  name: string;
  objective: string;
  domain: string;
  owner: string;
  frequency: string;
  threshold: string;
  last_run: string | null;
  status: string | null;
  exception_count: number;
  leakage: number;
  trend: string | null;
  coverage: number | null;
};

export type ControlsPayload = {
  synthetic: boolean;
  controls: ControlRow[];
  by_domain: { domain: string; n: number; passing: number; failing: number; leakage: number }[];
  kpis: GovernanceKpis | null;
};

export type TraceStep = {
  hop: string;
  ts: string | null;
  ref: string;
  status: string;
  amount: number | null;
  detail: string;
};

export type TraceResult = {
  query: string;
  resolved: { kind: string; id: string; merchant_id: string | null } | null;
  steps: TraceStep[];
};

export type NetworkNode = {
  id: string;
  kind: string;
  label: string;
  merchant_id: string | null;
  risk_score: number;
  is_known_bad: number;
};

export type NetworkEdge = { id: string; src: string; dst: string; rel: string; weight: number };

export type NetworkRiskPayload = {
  synthetic: boolean;
  note: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  proximity: { entity_id: string; dist: number }[];
};

export type SystemMap = {
  synthetic: boolean;
  nodes: { id: string; label: string; lane: string; href: string; x: number; y: number }[];
  edges: {
    source: string;
    target: string;
    href: string;
    leakage: number;
    match_rate: number;
    exceptions: number;
    label: string;
  }[];
};

export type AreaMeta = { id: string; label: string; group: string; blurb: string };

export type AreaSummary = {
  area: string;
  label: string;
  matched: number;
  unmatched: number;
  variance: number;
  leakage: number;
  match_rate: number;
  exception_count: number;
};

export type ExceptionRow = {
  exception_id: string;
  ref_id: string;
  area: string;
  status: string;
  category: string;
  merchant_id: string | null;
  ts: string | null;
  expected_amount: number;
  actual_amount: number;
  leakage: number;
  recon_ref: string | null;
  method: string | null;
  scheme: string | null;
  currency: string | null;
  severity: "high" | "medium" | "low";
};

export type Overview = {
  synthetic: boolean;
  kpis: {
    total_leakage: number;
    recovery_potential: number;
    match_rate: number;
    exception_count: number;
    auth_count: number;
    merchant_count: number;
  };
  areas: AreaSummary[];
  by_category: { area: string; category: string; n: number; leakage: number }[];
  trend: { day: string; leakage: number; n: number }[];
  flow: {
    capture: number;
    gateway_fees: number;
    scheme_gross: number;
    scheme_net: number;
    bank: number;
    payout: number;
    leakage_by_area: Record<string, number>;
  };
};

export type AreaDetail = {
  synthetic: boolean;
  meta: AreaMeta;
  summary: AreaSummary;
  series: { type: string; points: Record<string, unknown>[] };
  exceptions: ExceptionRow[];
};

export type Roster = {
  agents: { id: string; name: string; role: string; kind: string; domain?: string }[];
  edges: { source: string; target: string }[];
  run_all: string[];
};

export type LatestRun = {
  run: Record<string, unknown>;
  outputs: { agent_id: string; domain: string | null; output: unknown; created_at: string }[];
  actions: ActionRow[];
};

export type ActionRow = {
  action_id: string;
  run_id: string | null;
  exception_id: string | null;
  action: string;
  amount: number;
  currency: string | null;
  confidence: number | null;
  rationale: string | null;
  status: string;
  created_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
};


function parseJson(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return { text: v }; }
  }
  if (typeof v === "object") return v as Record<string, unknown>;
  return { text: String(v) };
}

export type ContractRule = {
  rule_id: string;
  doc_id?: string;
  party: string;
  fee_type: string;
  rate: number | string | null;
  unit: string;
  threshold?: number | string | null;
  citation: string;
  status: string;
  impact?: number;
  source?: string;
  rule_name?: string;
  sql_expression?: string | null;
  contract_citation?: string;
  tests_passed?: number;
  cap?: number | null;
  flat_fee?: number | null;
};

export type ContractsPayload = {
  documents: { doc_id: string; kind: string; title: string; party: string; chunks: number; rules: number; approved: number }[];
  rules: ContractRule[];
  impact: { category: string; merchant_id: string; leakage: number; recon_ref: string }[];
};

export type DocumentDetail = {
  document: Record<string, unknown>;
  chunks: Record<string, unknown>[];
  rules: ContractRule[];
};

export type AnomalyPayload = {
  events: { event_id: string; metric: string; segment: string; day: string; value: number; zscore: number; impact: number; status: string }[];
  open_count: number;
  series: { metric: string; segment: string; day: string; value: number; ewma: number; band_lo: number; band_hi: number; zscore: number; is_anomaly: number; volume: number }[];
  note: string;
};

export type RoutingPayload = {
  synthetic: boolean;
  simulation: boolean;
  policies: { policy: string; n: number; approval_current: number; approval_sim: number; approval_uplift: number; uplift_lo: number; uplift_hi: number; fee_current: number; fee_sim: number; fee_savings: number }[];
  segments: { policy: string; segment_kind: string; segment: string; n: number; approval_uplift: number; fee_savings: number }[];
  note: string;
};

export type CaseListItem = {
  case_id: string;
  title: string;
  status: string;
  owner: string | null;
  leakage: number;
  sla_due: string | null;
  overdue: boolean;
  cause_key: string;
  cause_label: string;
  exception_count: number;
};

export type ReviewListItem = {
  exception_id: string;
  area: string;
  merchant_id: string | null;
  review_status: string;
  amount: number;
  category: string;
};

export type ReviewDetail = {
  item: {
    exception_id: string;
    area: string;
    category: string;
    merchant_id: string | null;
    description: string;
    amount: number;
    facts: Record<string, unknown>;
    case_id: string | null;
    auditor_status: string;
    review_status: string;
  };
  investigator: Record<string, unknown>;
  action: Record<string, unknown>;
  auditor: Record<string, unknown>;
  suggestion_decisions: SuggestionDecision[];
};

export type AuditSuggestion = {
  suggestion_id: string;
  action: string;
  title: string;
  owner_team: string;
  priority: string;
  expected_recovery: number;
  maps_to: string;
  rationale: string;
};

export type SuggestionDecision = {
  suggestion_id: string;
  decision: string;
  comment?: string | null;
  action_id?: string | null;
  draft_id?: string | null;
};

export type AskResult = {
  question: string;
  sql: string;
  status: string;
  error?: string;
  rows: Record<string, unknown>[];
};


export type RuleTest = {
  test_id: string;
  name: string;
  inputs: Record<string, unknown>;
  expected: string;
  actual?: string | null;
  passed?: boolean | null;
  note?: string;
};

export type IngestionPayload = {
  files: { file_id: string; kind: string; filename: string; status: string; record_count: number; error_count: number; notes: string }[];
  rows: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  leakage: number;
  note: string;
  rates: { rupay_credit_mdr_bps: number; rupay_credit_threshold: number; ppi_interchange_pct: number; fx_markup_cap_bps: number; illustrative: boolean };
};


export type EvalQuality = {
  agents: { agent_id: string; n: number; faithfulness: number; hallucination_rate: number; retries: number; unverified: number }[];
  totals: { n: number; faithfulness: number; unverified: number; retries: number };
  note: string;
};
