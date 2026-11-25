/**
 * Read APP_SHARED_PASSWORD from the environment and write the PBKDF2 hash to stdout.
 * Refuses to print if stdout is a TTY. Never logs the password.
 */
import { hashPassword } from "../worker/password";

async function main() {
  if (process.stdout.isTTY) {
    console.error("Refusing to write the password hash to a terminal. Pipe this into wrangler secret put.");
    process.exit(1);
  }
  const password = process.env.APP_SHARED_PASSWORD || "";
  if (!password) {
    console.error("APP_SHARED_PASSWORD is not set.");
    process.exit(1);
  }
  const encoded = await hashPassword(password);
  const out = process.env.HASH_OUT;
  if (out) {
    const { writeFileSync, chmodSync } = await import("node:fs");
    writeFileSync(out, encoded, { mode: 0o600 });
    chmodSync(out, 0o600);
    return;
  }
  process.stdout.write(encoded);
}

void main();
