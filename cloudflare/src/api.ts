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
