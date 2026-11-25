import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";
import type { AppUser } from "../shared/roles";
import {
  USERS,
  canApproveAction,
  findUser,
  hasPermission,
  isAiLimitedPath,
  normalizeUsername,
  routePermission,
  type Role,
} from "../shared/roles";
import { AppError } from "../shared/errors";
import type { Env } from "./types";
import { getDb, type AppDb } from "./pg";
import { verifyPassword } from "./password";
import {
  clearSessionCookie,
  parseCookie,
  sessionCookie,
  signSession,
  verifySession,
  SESSION_COOKIE,
} from "./session";
import { clientIp, hitRateLimit } from "./rateLimit";

type Bindings = Env;
type Variables = { user?: AppUser; authChecked?: boolean };
export type AuthCtx = Context<{ Bindings: Bindings; Variables: Variables }>;

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_PER_USER_IP = 5;
const LOGIN_MAX_PER_IP = 20;
const AI_WINDOW_SEC = 10 * 60;
const AI_MAX_PER_SESSION = 20;
const AI_MAX_PER_IP = 40;

function isHttps(c: AuthCtx): boolean {
  const proto = c.req.header("x-forwarded-proto") || "";
  if (proto.toLowerCase() === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return true;
  }
}

export function currentUser(c: AuthCtx): AppUser | undefined {
  return c.get("user");
}

export function requireUser(c: AuthCtx): AppUser {
  const user = currentUser(c);
  if (!user) throw new HTTPException(401, { message: "Sign in required." });
  return user;
}

async function lockedOut(db: AppDb, username: string, ip: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - LOGIN_WINDOW_SEC * 1000).toISOString();
    const userRow = await db
      .prepare(
        "SELECT count(*)::int AS n FROM ra_login_attempts WHERE username=? AND ip=? AND ok=false AND at>=?",
      )
      .bind(username, ip, since)
      .first<{ n: number }>();
    const ipRow = await db
      .prepare("SELECT count(*)::int AS n FROM ra_login_attempts WHERE ip=? AND ok=false AND at>=?")
      .bind(ip, since)
      .first<{ n: number }>();
    return Number(userRow?.n ?? 0) >= LOGIN_MAX_PER_USER_IP || Number(ipRow?.n ?? 0) >= LOGIN_MAX_PER_IP;
  } catch {
    return false;
  }
}

async function recordAttempt(db: AppDb, username: string, ip: string, ok: boolean): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO ra_login_attempts (username, ip, ok, at) VALUES (?, ?, ?, now())")
      .bind(username, ip, ok)
      .run();
  } catch {
    /* table may not exist yet on a lagging branch */
  }
}

export async function recordAudit(
  env: Env,
  user: AppUser,
  method: string,
  path: string,
  action?: string,
  entityId?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getDb(env);
    await db
      .prepare(
        "INSERT INTO ra_audit_events (user_id, role, method, path, action, entity_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, now())",
      )
      .bind(user.id, user.role, method, path.slice(0, 300), action ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null)
      .run();
  } catch {
    /* never fail the write because the trail lagged */
  }
}

async function isRevoked(env: Env, userId: string, iat: number): Promise<boolean> {
  try {
    const row = await getDb(env)
      .prepare("SELECT revoked_before FROM ra_session_revoke WHERE user_id=?")
      .bind(userId)
      .first<{ revoked_before: string }>();
    if (!row?.revoked_before) return false;
    return iat <= Math.floor(new Date(row.revoked_before).getTime() / 1000);
  } catch {
    return false;
  }
}

async function revokeSessions(env: Env, userId: string): Promise<void> {
  try {
    await getDb(env)
      .prepare(
        "INSERT INTO ra_session_revoke (user_id, revoked_before) VALUES (?, now()) ON CONFLICT (user_id) DO UPDATE SET revoked_before=now()",
      )
      .bind(userId)
      .run();
  } catch {
    /* best-effort */
  }
}

export async function authMiddleware(c: AuthCtx, next: Next): Promise<Response | void> {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const method = c.req.method.toUpperCase();
  if (!path.startsWith("/api/")) return next();

  const perm = routePermission(method, path);

  const token = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
  const secret = c.env.SESSION_SECRET || "";
  const parsed = token && secret ? await verifySession(token, secret) : null;
  const user = parsed && !(await isRevoked(c.env, parsed.id, parsed.iat)) ? parsed : null;
  if (user) c.set("user", user);

  if (perm === "public") return next();
  if (perm === "self") return next();

  if (!user) throw new HTTPException(401, { message: "Sign in required." });

  if (perm === "deny") throw new HTTPException(403, { message: "You do not have permission for this action." });

  if (perm === "approve_action") {
    // Fine-grained check happens in the route after the action is loaded.
    if (
      !hasPermission(user.role, "approve_any") &&
      !hasPermission(user.role, "approve_treasury") &&
      !hasPermission(user.role, "approve_high_value") &&
      !hasPermission(user.role, "approve_review")
    ) {
      throw new HTTPException(403, { message: "You do not have permission to approve actions." });
    }
  } else if (!hasPermission(user.role, perm)) {
    throw new HTTPException(403, { message: "You do not have permission for this action." });
  }

  if (isAiLimitedPath(method, path)) {
    const ip = clientIp(c.req);
    const sessionHit = await hitRateLimit(`ai:sess:${user.id}`, AI_MAX_PER_SESSION, AI_WINDOW_SEC);
    const ipHit = await hitRateLimit(`ai:ip:${ip}`, AI_MAX_PER_IP, AI_WINDOW_SEC);
    if (!sessionHit.ok || !ipHit.ok) {
      const retry = Math.max(sessionHit.retryAfterSec, ipHit.retryAfterSec);
      throw new HTTPException(429, { message: `Too many AI requests. Try again in ${retry} seconds.` });
    }
  }

  await next();

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    c.executionCtx.waitUntil(recordAudit(c.env, user, method, path));
  }
}

export async function handleLogin(c: AuthCtx): Promise<Response> {
  try {
    return await handleLoginInner(c);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const name = err instanceof Error ? err.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    console.error("login_failed", name, msg.slice(0, 180));
    throw err;
  }
}

async function handleLoginInner(c: AuthCtx): Promise<Response> {
  const ip = clientIp(c.req);
  const burst = await hitRateLimit(`login:ip:${ip}`, 30, LOGIN_WINDOW_SEC);
  if (!burst.ok) throw new HTTPException(429, { message: "Too many login attempts. Try again later." });

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  const username = normalizeUsername(String(body.username || body.email || ""));
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    throw new HTTPException(400, { message: "username and password are required" });
  }

  const hash = c.env.APP_PASSWORD_HASH || "";
  const secret = c.env.SESSION_SECRET || "";
  if (!hash || !secret) {
    throw new HTTPException(503, { message: "Sign-in is not configured on this Worker." });
  }
  const db = getDb(c.env);
  if (await lockedOut(db, username, ip)) {
    throw new HTTPException(429, { message: "Too many login attempts. This account or address is temporarily locked." });
  }

  const user = findUser(username);
  const ok = await verifyPassword(password, hash);
  // Always hash even if the user is unknown, then reject uniformly.
  if (!user || !ok) {
    await recordAttempt(db, username || "unknown", ip, false);
    throw new HTTPException(401, { message: "Invalid username or password." });
  }
  await recordAttempt(db, user.id, ip, true);
  const token = await signSession(user, secret);
  c.header("Set-Cookie", sessionCookie(token, isHttps(c)));
  c.executionCtx.waitUntil(recordAudit(c.env, user, "POST", "/api/auth/login", "login"));
  return c.json({ ok: true, user: { id: user.id, role: user.role, name: user.name } });
}

export async function handleLogout(c: AuthCtx): Promise<Response> {
  const user = currentUser(c);
  c.header("Set-Cookie", clearSessionCookie(isHttps(c)));
  if (user) {
    await revokeSessions(c.env, user.id);
    c.executionCtx.waitUntil(recordAudit(c.env, user, "POST", "/api/auth/logout", "logout"));
  }
  return c.json({ ok: true });
}

export function handleMe(c: AuthCtx): Response {
  const user = currentUser(c);
  if (!user) throw new HTTPException(401, { message: "Sign in required." });
  return c.json({ user: { id: user.id, role: user.role, name: user.name } });
}

export function handleUsers(c: AuthCtx): Response {
  const user = requireUser(c);
  if (!hasPermission(user.role, "users")) {
    throw new HTTPException(403, { message: "You do not have permission for this action." });
  }
  return c.json({
    users: USERS.map((u) => ({ id: u.id, role: u.role, name: u.name })),
  });
}

export function assertCanApprove(
  role: Role,
  opts: { action?: string; exceptionId?: string | null; amount?: number | null },
): void {
  if (!canApproveAction(role, opts)) {
    throw new AppError("CFO or admin approval is required for high-value or out-of-role actions.", 403);
  }
}
