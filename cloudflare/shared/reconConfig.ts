/**
 * Recon rule configuration: types, defaults, validation and the row-level
 * tolerance test. Shared by the Worker, the UI and the tests.
 *
 * The defaults are all-zero tolerances, which reproduce the results the
 * hard-coded rules gave before rules moved into the database: a row is only
 * "within tolerance" when |leakage| is strictly below a positive limit.
 */
import { normalizeAmount } from "./numbers";

export const CONFIG_AREAS = ["scheme", "apm", "authorization", "gl", "invoicing"] as const;
export type ConfigArea = (typeof CONFIG_AREAS)[number];

/** Columns of ra_exception_rows a matching key may name. */
export const MATCHING_KEY_COLUMNS = ["ref_id", "recon_ref", "merchant_id", "scheme", "method", "currency", "ts"] as const;

export type AreaRuleConfig = {
  /** INR. Rows with |leakage| strictly below this are within tolerance. */
  amount_tolerance: number;
  /** bps of expected_amount, applied to non-INR (FX) rows or FX categories. */
  fx_tolerance_bps: number;
  /** bps of expected_amount, applied to fee categories (category contains "fee"). */
  fee_variance_bps: number;
  /** Rows dated within N days of the area's latest row are still in the matching window. */
  date_window_days: number;
  matching_keys: string[];
};

export type ReconRuleConfig = {
  global: { match_good: number; match_watch: number };
  areas: Record<ConfigArea, AreaRuleConfig>;
};

const zero = (keys: string[]): AreaRuleConfig => ({
  amount_tolerance: 0,
  fx_tolerance_bps: 0,
  fee_variance_bps: 0,
  date_window_days: 0,
  matching_keys: keys,
});

export const DEFAULT_RECON_CONFIG: ReconRuleConfig = {
  global: { match_good: 0.98, match_watch: 0.9 },
  areas: {
    scheme: zero(["recon_ref", "scheme", "currency"]),
    apm: zero(["ref_id", "method", "merchant_id"]),
    authorization: zero(["ref_id", "merchant_id"]),
    gl: zero(["recon_ref", "ref_id"]),
    invoicing: zero(["merchant_id", "ref_id"]),
  },
};

export const LIMITS = {
  amount_tolerance: { min: 0, max: 100_000 },
  fx_tolerance_bps: { min: 0, max: 500 },
  fee_variance_bps: { min: 0, max: 500 },
  date_window_days: { min: 0, max: 30 },
} as const;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

/** Validate and normalise a full config. Returns errors instead of throwing. */
export function validateReconConfig(input: unknown): { ok: true; config: ReconRuleConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const g = (src.global && typeof src.global === "object" ? src.global : {}) as Record<string, unknown>;
  const good = num(g.match_good ?? DEFAULT_RECON_CONFIG.global.match_good);
  const watch = num(g.match_watch ?? DEFAULT_RECON_CONFIG.global.match_watch);
  if (!(good > 0 && good <= 1)) errors.push("global.match_good must be in (0, 1]");
  if (!(watch > 0 && watch <= 1)) errors.push("global.match_watch must be in (0, 1]");
  if (good > 0 && watch > 0 && watch > good) errors.push("global.match_watch must not exceed match_good");
  const areasIn = (src.areas && typeof src.areas === "object" ? src.areas : {}) as Record<string, unknown>;
  for (const k of Object.keys(areasIn)) {
    if (!(CONFIG_AREAS as readonly string[]).includes(k)) errors.push(`unknown area "${k}"`);
  }
  const areas = {} as Record<ConfigArea, AreaRuleConfig>;
  for (const area of CONFIG_AREAS) {
    const a = (areasIn[area] && typeof areasIn[area] === "object" ? areasIn[area] : DEFAULT_RECON_CONFIG.areas[area]) as Record<string, unknown>;
    const out = { ...DEFAULT_RECON_CONFIG.areas[area] };
    for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      const v = num(a[field] ?? DEFAULT_RECON_CONFIG.areas[area][field]);
      const { min, max } = LIMITS[field];
      if (!Number.isFinite(v) || v < min || v > max) {
        errors.push(`${area}.${field} must be a number between ${min} and ${max}`);
        continue;
      }
      if (field === "date_window_days" && !Number.isInteger(v)) {
        errors.push(`${area}.date_window_days must be a whole number`);
        continue;
      }
      out[field] = field === "amount_tolerance" ? normalizeAmount(v) : v;
    }
    const keys = a.matching_keys ?? DEFAULT_RECON_CONFIG.areas[area].matching_keys;
    if (!Array.isArray(keys) || !keys.length) {
      errors.push(`${area}.matching_keys must be a non-empty list`);
    } else {
      const bad = keys.filter((x) => !(MATCHING_KEY_COLUMNS as readonly string[]).includes(String(x)));
      if (bad.length) errors.push(`${area}.matching_keys has unknown column(s): ${bad.join(", ")}`);
      else out.matching_keys = [...new Set(keys.map(String))];
    }
    areas[area] = out;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { global: { match_good: good, match_watch: watch }, areas } };
}

/** Field-level differences between two configs, for the audit trail. */
export function diffReconConfig(oldC: ReconRuleConfig, newC: ReconRuleConfig): { path: string; old: unknown; new: unknown }[] {
  const out: { path: string; old: unknown; new: unknown }[] = [];
  for (const k of ["match_good", "match_watch"] as const) {
    if (oldC.global[k] !== newC.global[k]) out.push({ path: `global.${k}`, old: oldC.global[k], new: newC.global[k] });
  }
  for (const area of CONFIG_AREAS) {
    const o = oldC.areas[area] ?? DEFAULT_RECON_CONFIG.areas[area];
    const n = newC.areas[area];
    for (const f of ["amount_tolerance", "fx_tolerance_bps", "fee_variance_bps", "date_window_days"] as const) {
      if (o[f] !== n[f]) out.push({ path: `${area}.${f}`, old: o[f], new: n[f] });
    }
    if (o.matching_keys.join(",") !== n.matching_keys.join(",")) {
      out.push({ path: `${area}.matching_keys`, old: o.matching_keys, new: n.matching_keys });
    }
  }
  return out;
}

export type ToleranceRow = {
  category: string;
  currency?: string | null;
  ts?: string | null;
  expected_amount?: number | null;
  leakage: number;
};

/** Why a row is within tolerance, or null when it is a break. Strict "<" so zero limits never clear a row. */
export function withinTolerance(row: ToleranceRow, cfg: AreaRuleConfig | undefined, latestTs?: string | null): string | null {
  if (!cfg) return null;
  const abs = Math.abs(Number(row.leakage || 0));
  if (cfg.amount_tolerance > 0 && abs < cfg.amount_tolerance) return "amount_tolerance";
  const base = Math.abs(Number(row.expected_amount || 0));
  const cat = String(row.category || "").toLowerCase();
  const isFx = cat.includes("fx") || (row.currency != null && row.currency !== "" && row.currency !== "INR");
  if (cfg.fx_tolerance_bps > 0 && isFx && base > 0 && abs < (base * cfg.fx_tolerance_bps) / 10_000) return "fx_tolerance_bps";
  if (cfg.fee_variance_bps > 0 && cat.includes("fee") && base > 0 && abs < (base * cfg.fee_variance_bps) / 10_000) return "fee_variance_bps";
  if (cfg.date_window_days > 0 && latestTs && row.ts) {
    const latest = Date.parse(String(latestTs).slice(0, 10));
    const d = Date.parse(String(row.ts).slice(0, 10));
    if (Number.isFinite(latest) && Number.isFinite(d) && latest - d < cfg.date_window_days * 86_400_000) return "date_window_days";
  }
  return null;
}

/** True when an area's config can clear rows (so the caller must read rows). */
export function hasActiveTolerance(cfg: AreaRuleConfig | undefined): boolean {
  return !!cfg && (cfg.amount_tolerance > 0 || cfg.fx_tolerance_bps > 0 || cfg.fee_variance_bps > 0 || cfg.date_window_days > 0);
}

export function matchQualityWith(rate: number, g: { match_good: number; match_watch: number } = DEFAULT_RECON_CONFIG.global): "good" | "watch" | "poor" {
  if (rate >= g.match_good) return "good";
  if (rate >= g.match_watch) return "watch";
  return "poor";
}
