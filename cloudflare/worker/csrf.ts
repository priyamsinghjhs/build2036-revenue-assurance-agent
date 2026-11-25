/** Basic CSRF protection for mutating requests. Token stored in session cookie companion or double-submit. */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "csrf-token";

export function csrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function csrfMiddleware(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  const header = c.req.header(CSRF_HEADER) || "";
  const cookie = c.req.header("cookie") || "";
  const match = cookie.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`));
  const cookieToken = match ? match[1] : "";

  if (!header || header !== cookieToken) {
    throw new HTTPException(403, { message: "CSRF token missing or invalid." });
  }
  return next();
}
