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
};
