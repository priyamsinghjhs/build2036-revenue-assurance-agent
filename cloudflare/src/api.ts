import type { InvestigationResult, SettlementListRow } from "./types";

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
    const err = data as { error?: string };
    throw new Error(err?.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export function fetchSettlements() {
  return request<{ settlements: SettlementListRow[] }>("/api/settlements");
}

export function runAgent(path: string, body: Record<string, unknown>) {
  return request<InvestigationResult>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
