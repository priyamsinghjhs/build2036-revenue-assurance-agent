import type { ExecPayload } from "./executive";

import { EXPOSURE_AREAS } from "../shared/bookLeakage";

function inr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Leadership brief built only from the current executive KPIs (book exception count included). */
export function deterministicBullets(exec: ExecPayload): string[] {
  const k = exec.kpis;
  const top = exec.top_drivers[0];
  const bookHeat = exec.heatmap.filter((h) => !(EXPOSURE_AREAS as readonly string[]).includes(h.area));
  const worst = [...bookHeat].sort((a, b) => a.match_rate - b.match_rate)[0];
  const ageing = exec.ageing.find((a) => a.bucket === "61+ days") ?? exec.ageing[exec.ageing.length - 1];
  const bullets = [
    `Gross acquiring volume of ${inr(k.revenue)} in ${exec.period.label} carried ${inr(k.leakage)} of leakage (${pct(k.leakage_pct)} of revenue) across ${k.exception_count} open exceptions.`,
    top
      ? `The largest driver is ${top.category.replace(/_/g, " ")} in ${top.area} (${inr(top.leakage)}, ${top.n} cases).`
      : `Overall match rate is ${pct(k.match_rate)}.`,
    worst
      ? `${worst.label} is the weakest domain at ${pct(worst.match_rate)} match and ${inr(worst.leakage)} leakage.`
      : `Recoverable leakage stands at ${inr(k.recoverable)}.`,
    `Recovery position: ${inr(k.recovered)} recovered, ${inr(k.recoverable)} still recoverable, ${inr(k.written_off)} written off.`,
  ];
  if (ageing && ageing.n > 0) {
    bullets.push(`${ageing.n} exceptions in the ${ageing.bucket} SLA bucket represent ${inr(ageing.leakage)} at risk of ageing out.`);
  } else {
    bullets.push(`Book-level match rate is ${pct(k.match_rate)} on ${k.auth_count.toLocaleString("en-IN")} authorizations.`);
  }
  return bullets.slice(0, 5);
}

/** True when any brief bullet cites an open-exception count that differs from the KPI. */
export function briefExceptionCountMatches(bullets: string[], exceptionCount: number): boolean {
  const re = /(\d[\d,]*)\s+open exceptions/i;
  let seen = false;
  for (const b of bullets) {
    const m = b.match(re);
    if (!m) continue;
    seen = true;
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (n !== exceptionCount) return false;
  }
  return seen;
}

/** Replace a stale stored brief so the CFO narrative always uses the book KPI count. */
export function alignNarrativeToKpis(
  narrative: ExecPayload["narrative"],
  exec: ExecPayload,
): ExecPayload["narrative"] {
  const bullets = narrative?.bullets ?? [];
  if (briefExceptionCountMatches(bullets, exec.kpis.exception_count)) {
    return narrative;
  }
  return {
    bullets: deterministicBullets(exec),
    source: "deterministic",
    generated_at: narrative?.generated_at ?? new Date().toISOString(),
  };
}
