import { findUser, hasPermission, canApproveAction, routePermission, normalizeUsername, HIGH_VALUE_INR } from "../shared/roles";
import { hashPassword, verifyPassword, timingSafeEqual } from "../worker/password";
import { signSession, verifySession } from "../worker/session";
import { isOutOfScopeQuestion } from "../shared/askScope";
import { publicErrorMessage, AppError } from "../shared/errors";
import { assertHttpsUrl, isPrivateIPv4, isPrivateIPv6, hostnameBlocked } from "../worker/ssrf";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeUsername("admin") === "admin@ra.local", "normalize short name");
assert(findUser("cfo")?.role === "cfo", "find cfo");
assert(hasPermission("viewer", "read") && !hasPermission("viewer", "settings"), "viewer perms");
assert(hasPermission("admin", "settings") && hasPermission("auditor", "audit"), "admin/auditor");
assert(!canApproveAction("treasury", { action: "recover settlement", amount: HIGH_VALUE_INR }), "treasury cannot high-value");
assert(canApproveAction("treasury", { action: "recover settlement", amount: 1000 }), "treasury can low treasury");
assert(canApproveAction("cfo", { action: "recover settlement", amount: 200_000 }), "cfo high-value");
assert(!canApproveAction("viewer", { action: "recover", amount: 10 }), "viewer cannot approve");
assert(routePermission("GET", "/api/executive") === "read", "exec read");
assert(routePermission("POST", "/api/automation/run") === "automation", "automation");
assert(routePermission("POST", "/api/auth/login") === "public", "login public");
assert(routePermission("DELETE", "/api/settings/data-sources/x") === "settings", "ds delete");
assert(routePermission("POST", "/api/foo") === "deny", "unknown post denied");

assert(isOutOfScopeQuestion("What's the weather in Delhi tomorrow?"), "weather oos");
assert(!isOutOfScopeQuestion("What is total book leakage in October 2026?"), "leakage in scope");

assert(publicErrorMessage(new Error("numeric field overflow")) !== "numeric field overflow", "no raw overflow");
assert(publicErrorMessage(new AppError("A comment is required", 400)).includes("comment"), "allow comment");
assert(publicErrorMessage(new Error("Rule not found")) === "Rule not found", "not found allowed");

assert(isPrivateIPv4("127.0.0.1") && isPrivateIPv4("10.0.0.1") && isPrivateIPv4("192.168.0.1"), "rfc1918");
assert(isPrivateIPv4("169.254.169.254"), "metadata");
assert(!isPrivateIPv4("8.8.8.8"), "public v4");
assert(isPrivateIPv6("::1") && isPrivateIPv6("fe80::1"), "v6 local");
assert(hostnameBlocked("localhost") && hostnameBlocked("metadata.google.internal"), "blocked hosts");
let threw = false;
try { assertHttpsUrl("http://example.com/"); } catch { threw = true; }
assert(threw, "http rejected");
threw = false;
try { assertHttpsUrl("file:///etc/passwd"); } catch { threw = true; }
assert(threw, "file rejected");
assertHttpsUrl("https://example.com/path");

const enc = await hashPassword("correct-horse-test-only");
assert(enc.startsWith("pbkdf2-sha256$"), "hash format");
assert(await verifyPassword("correct-horse-test-only", enc), "verify ok");
assert(!(await verifyPassword("wrong-password", enc)), "verify fail");
assert(!(await verifyPassword("correct-horse-test-only", "pbkdf2-sha256$210000$abcd$abcd")), "junk hash");

const user = findUser("admin")!;
const secret = "test-session-secret-not-for-prod-use-only";
const token = await signSession(user, secret);
assert((await verifySession(token, secret))?.id === "admin@ra.local", "session ok");
assert((await verifySession(token, "other-secret")) === null, "bad secret");
const expired = await signSession(user, secret, Date.now() - 9 * 60 * 60 * 1000);
assert((await verifySession(expired, secret)) === null, "expired session");

const a = new Uint8Array([1, 2, 3]);
assert(timingSafeEqual(a, new Uint8Array([1, 2, 3])) && !timingSafeEqual(a, new Uint8Array([1, 2, 4])), "tseq");

console.log("test-auth ok");
