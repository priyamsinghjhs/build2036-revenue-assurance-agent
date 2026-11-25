import {
  areaFromExceptionId,
  areaFromPath,
  areaInRoleScope,
  normalizeArea,
  recordInScope,
  ROLE_AREA_SCOPE,
} from "../shared/scope";
import { navVisible } from "../shared/roles";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeArea("/payouts") === "payouts", "slug payouts");
assert(normalizeArea("bank") === "bank_trs", "bank alias");
assert(normalizeArea("false-declines") === "false_declines", "false declines");
assert(areaFromExceptionId("payouts:under_payout:PAY-MER002-2026-10") === "payouts", "exc id");
assert(areaFromExceptionId("exception:aml:aml_velocity_spike:velocity_spike-MER006") === "aml", "run scope");
assert(areaFromPath("/funding") === "funding", "path");
assert(areaFromPath("/network-risk") === "network_risk", "network-risk path");

assert(ROLE_AREA_SCOPE.admin === "all" && ROLE_AREA_SCOPE.cfo === "all" && ROLE_AREA_SCOPE.auditor === "all", "all-access roles");
assert(areaInRoleScope("viewer", "authorization") && !areaInRoleScope("viewer", "payouts"), "viewer slice");
assert(areaInRoleScope("treasury", "payouts") && !areaInRoleScope("treasury", "aml"), "treasury queue");
assert(areaInRoleScope("recon_ops", "scheme") && !areaInRoleScope("recon_ops", "aml"), "recon queue excludes aml");
assert(recordInScope("recon_ops", { area: "aml", assignedToUser: true }), "assignment opens aml for recon_ops");
assert(!recordInScope("recon_ops", { area: "aml", assignedToUser: false }), "unassigned aml hidden");
assert(!recordInScope("viewer", { area: "payouts", assignedToUser: false }), "viewer no payouts");
assert(recordInScope("admin", { area: "aml" }), "admin sees aml");

assert(navVisible("viewer", "/authorization") && !navVisible("viewer", "/payouts") && !navVisible("viewer", "/funding"), "viewer nav hidden");
assert(navVisible("admin", "/payouts") && navVisible("cfo", "/settings") === false, "cfo no settings");
assert(navVisible("treasury", "/payouts") && !navVisible("treasury", "/kyc"), "treasury nav");
assert(navVisible("recon_ops", "/scheme") && !navVisible("recon_ops", "/aml"), "recon nav hides unassigned aml area");

console.log("test-scope ok");
