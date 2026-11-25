/** Record-level (object) scope. Shared by the Worker and the UI. */

import type { Role } from "./roles";

/** Canonical area ids used on exception rows and in /api/areas/:id. */
export const ALL_AREAS = [
  "authorization",
  "scheme",
  "bank_trs",
  "gateway",
  "network",
  "partner",
  "terminal",
  "apm",
  "fx",
  "pricing",
  "payouts",
  "chargebacks",
  "billing",
  "invoicing",
  "cash_ar",
  "vendor",
  "gl",
  "hops",
  "settlement",
  "funding",
  "acquirer",
  "config",
  "tax",
  "kyc",
  "interfaces",
  "aml",
  "network_risk",
  "success",
  "contracts",
  "files",
  "anomalies",
  "clearing",
  "false_declines",
] as const;

export type AreaName = (typeof ALL_AREAS)[number];

const SLUG_TO_AREA: Record<string, AreaName> = {
  authorization: "authorization",
  scheme: "scheme",
  bank: "bank_trs",
  bank_trs: "bank_trs",
  fees: "gateway",
  gateway: "gateway",
  network: "network",
  partner: "partner",
  terminals: "terminal",
  terminal: "terminal",
  apm: "apm",
  fx: "fx",
  pricing: "pricing",
  payouts: "payouts",
  chargebacks: "chargebacks",
  billing: "billing",
  invoicing: "invoicing",
  cash: "cash_ar",
  cash_ar: "cash_ar",
  vendors: "vendor",
  vendor: "vendor",
  gl: "gl",
  hops: "hops",
  settlement: "settlement",
  funding: "funding",
  acquirer: "acquirer",
  config: "config",
  tax: "tax",
  kyc: "kyc",
  interfaces: "interfaces",
  aml: "aml",
  "network-risk": "network_risk",
  network_risk: "network_risk",
  success: "success",
  contracts: "contracts",
  files: "files",
  anomalies: "anomalies",
  clearing: "clearing",
  "false-declines": "false_declines",
  false_declines: "false_declines",
};

const TREASURY_AREAS: readonly AreaName[] = [
  "payouts",
  "funding",
  "bank_trs",
  "scheme",
  "settlement",
  "gateway",
  "network",
  "partner",
  "cash_ar",
  "billing",
  "invoicing",
  "chargebacks",
  "fx",
  "pricing",
  "acquirer",
];

const RECON_OPS_AREAS: readonly AreaName[] = [
  "authorization",
  "scheme",
  "bank_trs",
  "settlement",
  "funding",
  "acquirer",
  "gateway",
  "network",
  "partner",
  "terminal",
  "apm",
  "fx",
  "pricing",
  "payouts",
  "chargebacks",
  "false_declines",
  "hops",
  "interfaces",
  "files",
  "clearing",
  "config",
  "billing",
  "invoicing",
  "cash_ar",
  "vendor",
  "gl",
  "success",
];

const VIEWER_AREAS: readonly AreaName[] = [
  "authorization",
  "scheme",
  "false_declines",
  "success",
  "tax",
];

/**
 * admin/cfo see every record. auditor is read-only (enforced by permissions)
 * but may read the whole book. treasury and recon_ops have domain queues;
 * recon_ops may also see assigned records outside the queue. viewer is a
 * reporting slice only.
 */
export const ROLE_AREA_SCOPE: Record<Role, "all" | readonly AreaName[]> = {
  admin: "all",
  cfo: "all",
  auditor: "all",
  treasury: TREASURY_AREAS,
  recon_ops: RECON_OPS_AREAS,
  viewer: VIEWER_AREAS,
};

export type RecordObjectType = "exception" | "review" | "action" | "case" | "draft" | "contract" | "area";

export function normalizeArea(raw: string | null | undefined): AreaName | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/^\//, "").split("/")[0];
  return SLUG_TO_AREA[key] ?? (ALL_AREAS.includes(key as AreaName) ? (key as AreaName) : null);
}

/** area:category:ref_id — also accepts a leading "exception:" from run scopes. */
export function areaFromExceptionId(id: string | null | undefined): AreaName | null {
  if (!id) return null;
  const raw = id.trim();
  const parts = raw.startsWith("exception:") ? raw.slice("exception:".length).split(":") : raw.split(":");
  if (parts.length >= 3) return normalizeArea(parts[0]);
  return normalizeArea(raw);
}

export function areaFromPath(href: string): AreaName | null {
  if (!href) return null;
  const path = href.split("?")[0];
  if (path === "/network-risk") return "network_risk";
  if (path === "/false-declines") return "false_declines";
  if (path === "/fees") return "gateway";
  return normalizeArea(path);
}

export function roleSeesAllAreas(role: Role): boolean {
  return ROLE_AREA_SCOPE[role] === "all";
}

export function areaInRoleScope(role: Role, area: string | null | undefined): boolean {
  if (ROLE_AREA_SCOPE[role] === "all") return true;
  const canonical = normalizeArea(area);
  if (!canonical) return false;
  return (ROLE_AREA_SCOPE[role] as readonly AreaName[]).includes(canonical);
}

/** Visibility after considering an optional assignment to this user. */
export function recordInScope(
  role: Role,
  opts: { area?: string | null; assignedToUser?: boolean },
): boolean {
  if (ROLE_AREA_SCOPE[role] === "all") return true;
  if (opts.assignedToUser) return true;
  return areaInRoleScope(role, opts.area ?? null);
}

export const SCOPE_NOT_FOUND = "Not found";
