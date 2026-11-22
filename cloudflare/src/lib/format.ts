/** INR with Indian units: ₹ crore / lakh above the relevant thresholds. */
export function inr(n: number, compact = false): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (compact && abs >= 10_000_000) {
    return `${sign}₹${trimNum(abs / 10_000_000)} Cr`;
  }
  if (compact && abs >= 100_000) {
    return `${sign}₹${trimNum(abs / 100_000)} L`;
  }
  return `${sign}${new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: compact && abs >= 1000 ? 0 : abs < 1 ? 2 : abs < 100 ? 2 : 0,
  }).format(abs)}`;
}

function trimNum(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

const ACRONYMS = new Set([
  "AML", "KYC", "GST", "UPI", "MDR", "SLA", "TDS", "NPCI", "E2E", "FX", "GL",
  "POS", "QR", "IMPS", "NEFT", "RTGS", "PPI", "P2M", "P2P", "NPA", "RBI",
  "API", "IPM", "ACH", "NACH", "IMPS", "CBS", "MIS", "ATM", "EMI", "PAN",
  "TIN", "MCC", "BIN", "ARN", "RRN", "STAN", "PCI", "SOC", "ISO",
]);

const CATEGORY_LABELS: Record<string, string> = {
  aml_velocity_spike: "AML velocity spike",
  aml_dormant_burst: "AML dormant burst",
  aml_structuring: "AML structuring",
  aml_round_trip: "AML round trip",
  kyc_pending_transacting: "KYC pending transacting",
  missing_scheme_settlement: "Missing scheme settlement",
};

/** Human-readable category: 'AML velocity spike', not 'aml_velocity_spike'. */
export function prettyCat(s: string): string {
  if (!s) return s;
  if (CATEGORY_LABELS[s]) return CATEGORY_LABELS[s];
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export const BOOK_AS_OF = "2026-11-21";
export const BOOK_PERIOD = { from: "2026-10-01", to: "2026-10-31", label: "October 2026" };
