/**
 * Post-build guard: fail the build (and therefore any Workers Builds deploy) if the SPA bundle
 * is missing a page the Worker serves. Catches a main branch that lacks merged pages.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["/recon-rules", "/recovery", "/review", "/agents"];
const dir = new URL("../dist/assets/", import.meta.url).pathname;
const js = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
const missing = REQUIRED.filter((r) => !js.includes(`"${r}"`) && !js.includes(`'${r}'`) && !js.includes(`\`${r}`));
if (missing.length) {
  console.error(`check-bundle: SPA bundle is missing routes: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`check-bundle: ${REQUIRED.length} required routes present`);
