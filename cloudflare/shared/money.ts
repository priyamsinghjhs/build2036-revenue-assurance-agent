/** Format a rupee amount with the ₹ sign and Indian grouping, always two decimals (₹19,421.10). */
export function inrExact(n: number): string {
  if (!Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  const body = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}₹${body}`;
}

export function inrMaybe(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹]/g, ""));
  if (!Number.isFinite(n)) return null;
  return inrExact(n);
}
