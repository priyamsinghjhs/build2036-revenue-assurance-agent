/** Shared CSRF middleware for every state-changing request. */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "csrf-token";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that must remain public and unauthenticated. */
const EXEMPT = [
  /^\/api\/auth\/login\/?$/,
  /^\/healthz\/?$/,
  /^\/api\/health\/?$/,
];

export function csrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isExempt(path: string): boolean {
  return EXEMPT.some((re) => re.test(path));
}

/**
 * Apply to the whole app. Safe methods and exempt paths pass through.
 * All other state-changing requests require a matching double-submit token.
 */
export async function csrfMiddleware(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  if (!MUTATING.has(method)) return next();

  const path = c.req.path.split("?")[0];
  if (isExempt(path)) return next();

  const header = c.req.header(CSRF_HEADER) || "";
  const cookie = c.req.header("cookie") || "";
  const match = cookie.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`));
  const cookieToken = match ? decodeURIComponent(match[1]) : "";

  if (!header || header !== cookieToken) {
    throw new HTTPException(403, { message: "CSRF token missing or invalid." });
  }
  return next();
}
