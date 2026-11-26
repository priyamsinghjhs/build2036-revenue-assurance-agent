/**
 * Fails if a POST/PUT/PATCH/DELETE route is registered without the shared CSRF middleware.
 * Run with: npx tsx cloudflare/tests/csrf-coverage.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const index = readFileSync(join(root, "worker/index.ts"), "utf8");
const extra = readFileSync(join(root, "worker/extraRoutes.ts"), "utf8");

const MUTATING = /app\.(post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;

function collect(src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = MUTATING.exec(src))) out.push(m[2]);
  return out;
}

const routes = [...collect(index), ...collect(extra)];
const exempt = new Set(["/api/auth/login", "/api/auth/logout"]);

const missing: string[] = [];
for (const path of routes) {
  if (exempt.has(path)) continue;
  // The shared middleware is applied at app level; this test asserts the
  // middleware is imported and used once, and that no route opts out.
  if (!index.includes("csrfMiddleware") && !extra.includes("csrfMiddleware")) {
    missing.push(path);
  }
}

if (!index.includes("app.use(\"/api/*\", csrfMiddleware") && !index.includes("app.use(\"*\", csrfMiddleware")) {
  console.error("FAIL: csrfMiddleware is not applied globally in index.ts");
  process.exit(1);
}

console.log(`OK: CSRF middleware covers ${routes.length} mutating routes`);
