import { normalizeAmount } from "./numbers";

/** Areas whose amounts are risk/ops exposure, not book leakage. */
export const EXPOSURE_AREAS = [
  "aml",
  "network_risk",
  "kyc",
  "success",
  "interfaces",
  "anomalies",
  "files",
] as const;

export type ExposureArea = (typeof EXPOSURE_AREAS)[number];

export const BOOK_LEAKAGE_SQL =
  "area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')";

export function isExposureArea(area: string): boolean {
  return (EXPOSURE_AREAS as readonly string[]).includes(area);
}

export type LiveAreaLeakage = { area: string; n: number; leakage: number };

/** Prefer live exception-row totals when any rows exist; otherwise keep the stored summary. */
export function overlayLiveSummary<T extends { area: string; leakage: number; exception_count: number }>(
  row: T,
  live: Map<string, LiveAreaLeakage>,
): T {
  const hit = live.get(row.area);
  if (!hit || hit.n <= 0) {
    return { ...row, leakage: normalizeAmount(row.leakage), exception_count: Number(row.exception_count) };
  }
  return { ...row, leakage: hit.leakage, exception_count: hit.n };
}

export function bookTotalsFromAreas(
  areas: { area: string; leakage: number; exception_count: number }[],
): { leakage: number; exception_count: number } {
  let leakage = 0;
  let exception_count = 0;
  for (const a of areas) {
    if (isExposureArea(a.area)) continue;
    leakage += Number(a.leakage ?? 0);
    exception_count += Number(a.exception_count ?? 0);
  }
  return { leakage: normalizeAmount(leakage), exception_count };
}
