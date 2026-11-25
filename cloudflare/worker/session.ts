import type { AppUser, Role } from "../shared/roles";
import { findUser, ROLES } from "../shared/roles";

const COOKIE = "ra_session";
export const SESSION_TTL_SEC = 8 * 60 * 60;
const VERSION = 1;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type SessionPayload = {
  v: number;
  sub: string;
  role: Role;
  iat: number;
  exp: number;
};

export async function signSession(user: AppUser, secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    v: VERSION,
    sub: user.id,
    role: user.role,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_TTL_SEC,
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export type VerifiedSession = AppUser & { iat: number; exp: number };

export async function verifySession(token: string, secret: string, now = Date.now()): Promise<VerifiedSession | null> {
  if (!token || !secret || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let expected: Uint8Array;
  let given: Uint8Array;
  try {
    expected = await hmac(secret, body);
    given = unb64url(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, given)) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload;
    if (json.v !== VERSION || typeof json.sub !== "string") return null;
    if (!ROLES.includes(json.role)) return null;
    if (json.exp * 1000 <= now) return null;
    const user = findUser(json.sub);
    if (!user || user.role !== json.role) return null;
    return { ...user, iat: json.iat, exp: json.exp };
  } catch {
    return null;
  }
}

export function parseCookie(header: string | undefined, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_TTL_SEC): string {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export { COOKIE as SESSION_COOKIE };
