import { areaFromPath, areaInRoleScope } from "./scope";

/** App-level RBAC. Shared by the Worker and the UI. */

export const ROLES = ["admin", "cfo", "treasury", "recon_ops", "auditor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "read"
  | "ask"
  | "audit"
  | "recon_run"
  | "action_draft"
  | "approve_review"
  | "approve_treasury"
  | "approve_high_value"
  | "approve_any"
  | "settings"
  | "users"
  | "automation"
  | "learning";

export type AppUser = {
  id: string;
  role: Role;
  name: string;
};

/** High-value approvals (CFO or admin). Amounts are INR. */
export const HIGH_VALUE_INR = 50_000;

export const USERS: readonly AppUser[] = [
  { id: "admin@ra.local", role: "admin", name: "Admin" },
  { id: "cfo@ra.local", role: "cfo", name: "CFO" },
  { id: "treasury@ra.local", role: "treasury", name: "Treasury" },
  { id: "recon_ops@ra.local", role: "recon_ops", name: "Recon ops" },
  { id: "auditor@ra.local", role: "auditor", name: "Auditor" },
  { id: "viewer@ra.local", role: "viewer", name: "Viewer" },
] as const;

const ROLE_PERMS: Record<Role, readonly Permission[]> = {
  viewer: ["read", "ask"],
  auditor: ["read", "ask", "audit", "approve_review"],
  recon_ops: ["read", "ask", "recon_run", "action_draft"],
  treasury: ["read", "ask", "recon_run", "action_draft", "approve_treasury"],
  cfo: ["read", "ask", "audit", "approve_review", "approve_treasury", "approve_high_value"],
  admin: [
    "read",
    "ask",
    "audit",
    "recon_run",
    "action_draft",
    "approve_review",
    "approve_treasury",
    "approve_high_value",
    "approve_any",
    "settings",
    "users",
    "automation",
    "learning",
  ],
};

const TREASURY_ACTION_RE =
  /\b(payout|treasury|settlement|funding|recover|bank|trs|cash|fee|scheme_settlement)\b/i;

export function normalizeUsername(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) return s;
  return `${s}@ra.local`;
}

export function findUser(username: string): AppUser | undefined {
  const id = normalizeUsername(username);
  return USERS.find((u) => u.id === id);
}

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMS[role].includes(perm);
}

export function isTreasuryAction(action: string, exceptionId?: string | null): boolean {
  const hay = `${action || ""} ${exceptionId || ""}`;
  return TREASURY_ACTION_RE.test(hay);
}

export function canApproveAction(
  role: Role,
  opts: { action?: string; exceptionId?: string | null; amount?: number | null },
): boolean {
  if (hasPermission(role, "approve_any")) return true;
  const amount = Number(opts.amount ?? 0);
  const high = Number.isFinite(amount) && Math.abs(amount) >= HIGH_VALUE_INR;
  if (high) return hasPermission(role, "approve_high_value");
  if (isTreasuryAction(opts.action || "", opts.exceptionId)) {
    return hasPermission(role, "approve_treasury");
  }
  // Non-treasury, below threshold: CFO (high-value covers policy plus general executive approval) or admin.
  return hasPermission(role, "approve_high_value") || hasPermission(role, "approve_review");
}

export type RoutePermission = Permission | "public" | "self" | "approve_action";

type Rule = { methods: string[]; pattern: RegExp; perm: RoutePermission };

const RULES: Rule[] = [
  { methods: ["POST"], pattern: /^\/api\/auth\/login\/?$/, perm: "public" },
  { methods: ["POST"], pattern: /^\/api\/auth\/logout\/?$/, perm: "public" },
  { methods: ["GET"], pattern: /^\/api\/auth\/me\/?$/, perm: "self" },
  { methods: ["GET"], pattern: /^\/api\/auth\/users\/?$/, perm: "users" },
  { methods: ["GET"], pattern: /^\/api\/eval\/quality\/?$/, perm: "audit" },
  { methods: ["GET", "POST"], pattern: /^\/api\/audit(\/|$)/, perm: "audit" },
  { methods: ["GET"], pattern: /^\/api\/ask\/schema\/?$/, perm: "ask" },
  { methods: ["POST"], pattern: /^\/api\/ask\/?$/, perm: "ask" },
  { methods: ["POST"], pattern: /^\/api\/agents\/(runs|step|complete|investigate)\/?$/, perm: "recon_run" },
  { methods: ["POST"], pattern: /^\/api\/anomalies\/investigate\/?$/, perm: "recon_run" },
  { methods: ["POST"], pattern: /^\/api\/legacy\/agents\//, perm: "recon_run" },
  { methods: ["POST"], pattern: /^\/api\/automation\/run\/?$/, perm: "automation" },
  { methods: ["GET", "POST", "PUT", "DELETE"], pattern: /^\/api\/settings\//, perm: "settings" },
  { methods: ["POST"], pattern: /^\/api\/learning\/apply\/?$/, perm: "learning" },
  { methods: ["POST"], pattern: /^\/api\/ingestion\/parse\/?$/, perm: "settings" },
  { methods: ["POST"], pattern: /^\/api\/contracts\/extract\/?$/, perm: "recon_run" },
  { methods: ["POST"], pattern: /^\/api\/contracts\/rules\/[^/]+\/decision\/?$/, perm: "approve_review" },
  { methods: ["POST"], pattern: /^\/api\/contracts\/rules\/[^/]+\/test\/?$/, perm: "recon_run" },
  { methods: ["POST"], pattern: /^\/api\/drafts\/[^/]+\/decision\/?$/, perm: "approve_review" },
  { methods: ["POST"], pattern: /^\/api\/reviews\/[^/]+\/decision\/?$/, perm: "approve_review" },
  { methods: ["POST"], pattern: /^\/api\/actions\/[^/]+\/decision\/?$/, perm: "approve_action" },
  { methods: ["POST"], pattern: /^\/api\/cases\/[^/]+\/?$/, perm: "action_draft" },
  { methods: ["POST"], pattern: /^\/api\/(routing\/simulate|models\/predict|rules\/simulate)\/?$/, perm: "read" },
  { methods: ["GET"], pattern: /^\/api\//, perm: "read" },
];

export function routePermission(method: string, path: string): RoutePermission | "deny" {
  const m = method.toUpperCase();
  const pathname = path.split("?")[0];
  for (const rule of RULES) {
    if (rule.methods.includes(m) && rule.pattern.test(pathname)) return rule.perm;
  }
  return "deny";
}

export function isAiLimitedPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return (
    /^\/api\/ask\/?$/.test(path) ||
    /^\/api\/agents\/(investigate|step)\/?$/.test(path) ||
    /^\/api\/anomalies\/investigate\/?$/.test(path) ||
    /^\/api\/legacy\/agents\//.test(path) ||
    /^\/api\/contracts\/extract\/?$/.test(path)
  );
}

export function navVisible(role: Role, href: string): boolean {
  if (href === "/settings/users") return hasPermission(role, "users");
  if (href.startsWith("/settings")) return hasPermission(role, "settings");
  if (href === "/ingestion") return hasPermission(role, "settings") || hasPermission(role, "recon_run");
  const area = areaFromPath(href);
  if (area && !areaInRoleScope(role, area)) return false;
  return true;
}
