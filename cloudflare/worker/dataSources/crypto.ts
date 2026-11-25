/**
 * AES-GCM credential envelope. The key is the Worker secret DATA_SOURCES_KEK
 * (32-byte raw key, base64). The plaintext is never logged or returned.
 */

export class KekMissingError extends Error {
  constructor() {
    super("DATA_SOURCES_KEK is not configured on this Worker, so credentials cannot be stored or decrypted.");
    this.name = "KekMissingError";
  }
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function kekConfigured(secret: string | undefined): boolean {
  return Boolean(secret && secret.trim());
}

async function importKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || !secret.trim()) throw new KekMissingError();
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(secret.trim());
  } catch {
    throw new Error("DATA_SOURCES_KEK must be a base64-encoded 32-byte key.");
  }
  if (raw.byteLength !== 32) {
    throw new Error("DATA_SOURCES_KEK must be a base64-encoded 32-byte key.");
  }
  const copy = new Uint8Array(raw);
  return crypto.subtle.importKey("raw", copy, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(secret: string | undefined, value: Record<string, string>): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `v1:${bytesToB64(iv)}:${bytesToB64(cipher)}`;
}

export async function decryptJson(secret: string | undefined, envelope: string): Promise<Record<string, string>> {
  const key = await importKey(secret);
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unrecognized credential envelope.");
  const iv = b64ToBytes(parts[1]);
  const data = b64ToBytes(parts[2]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}
