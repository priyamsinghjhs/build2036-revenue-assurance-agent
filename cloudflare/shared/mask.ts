/** PAN / sensitive field masking for logs and responses. */

export function maskPan(pan: string | null | undefined): string {
  if (!pan) return "";
  const s = String(pan).replace(/\D/g, "");
  if (s.length < 10) return "****";
  return s.slice(0, 6) + "******" + s.slice(-4);
}

export function maskSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (/pan|card|account|iban/i.test(key) && typeof out[key] === "string") {
      out[key] = maskPan(out[key] as string);
    }
  }
  return out;
}
