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

export function prettyCat(s: string): string {
  return s.replace(/_/g, " ");
}

export const BOOK_AS_OF = "2026-11-21";
export const BOOK_PERIOD = { from: "2026-10-01", to: "2026-10-31", label: "October 2026" };
