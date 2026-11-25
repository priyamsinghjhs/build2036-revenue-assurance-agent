import { readFileSync } from "node:fs";

function redact(s) {
  return String(s)
    .replace(/postgres(?:ql)?:\/\/[^ \s'"]+/gi, "postgresql://***")
    .replace(/npg_[A-Za-z0-9]+/g, "npg_***");
}

/** Split SQL into statements, honoring quotes, comments, and $tag$ dollar quotes. */
export function splitSql(text) {
  const stmts = [];
  let i = 0;
  const n = text.length;
  let start = 0;
  let buf = "";
  const skipStartWs = () => {
    // handled by trim later
  };
  function push(s) {
    const t = s.trim();
    if (!t) return;
    const noComment = t
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    // still keep if it has SQL after comments
    const meaningful = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
    if (!meaningful) return;
    stmts.push(t);
  }
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === "--") {
      const e = text.indexOf("\n", i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (two === "/*") {
      const e = text.indexOf("*/", i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "$") {
      // dollar quote: $tag$
      const m = text.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        const e = text.indexOf(tag, i + tag.length);
        if (e === -1) {
          i = n;
        } else {
          i = e + tag.length;
        }
        continue;
      }
    }
    if (c === ";") {
      push(text.slice(start, i));
      i++;
      start = i;
      continue;
    }
    i++;
  }
  push(text.slice(start));
  return stmts;
}

function shouldSkip(stmt) {
  const s = stmt.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!s) return true;
  if (/^PRAGMA\b/i.test(s)) return true;
  if (/^(BEGIN|COMMIT|END|START\s+TRANSACTION)\s*;?$/i.test(s)) return true;
  return false;
}

const files = process.argv.slice(2);
if (files[0] === "--dry") {
  const dryFiles = files.slice(1);
  for (const f of dryFiles) {
    const stmts = splitSql(readFileSync(f, "utf8"));
    const kept = stmts.filter((s) => !shouldSkip(s));
    const skipped = stmts.filter((s) => shouldSkip(s));
    const sizes = kept.map((s) => s.length);
    const max = Math.max(0, ...sizes);
    const maxI = sizes.indexOf(max);
    const preview = kept[maxI] ? kept[maxI].slice(0, 80).replace(/\s+/g, " ") : "";
    console.log(JSON.stringify({
      file: f,
      parsed: stmts.length,
      apply: kept.length,
      skipped: skipped.length,
      skipped_previews: skipped.map((s) => s.replace(/\s+/g, " ").slice(0, 60)),
      max_stmt_bytes: max,
      max_stmt_preview: preview,
      total_apply_bytes: sizes.reduce((a, b) => a + b, 0),
    }, null, 2));
  }
  process.exit(0);
}

const { neon } = await import("@neondatabase/serverless");
const urlFile = process.env.DATABASE_URL_FILE || "/workspace/secrets/neon_database_url";
const url = (process.env.DATABASE_URL || readFileSync(urlFile, "utf8")).trim();
const sql = neon(url, { fetchOptions: { timeout: 120000 } });

async function applyFile(f) {
  const stmts = splitSql(readFileSync(f, "utf8")).filter((s) => !shouldSkip(s));
  console.log(`apply ${f} statements=${stmts.length}`);
  const MAX_BATCH_STMTS = 40;
  const MAX_BATCH_BYTES = 180_000;
  let i = 0;
  let batchNo = 0;
  while (i < stmts.length) {
    let bytes = 0;
    const batch = [];
    while (i < stmts.length && batch.length < MAX_BATCH_STMTS && (batch.length === 0 || bytes + stmts[i].length < MAX_BATCH_BYTES)) {
      batch.push(stmts[i]);
      bytes += stmts[i].length;
      i++;
    }
    batchNo++;
    const t0 = Date.now();
    try {
      if (batch.length === 1) {
        await sql.query(batch[0], []);
      } else {
        await sql.transaction(batch.map((q) => sql.query(q, [])));
      }
      console.log(`  batch ${batchNo} ok stmts=${batch.length} bytes=${bytes} ms=${Date.now() - t0} done=${i}/${stmts.length}`);
    } catch (err) {
      const msg = redact(err && (err.message || String(err)));
      const first = batch[0].replace(/\s+/g, " ").slice(0, 160);
      console.error(`  batch ${batchNo} FAIL stmts=${batch.length} done_before=${i - batch.length} err=${msg}`);
      console.error(`  first_stmt: ${first}`);
      throw err;
    }
  }
}

const t0 = Date.now();
try {
  const ping = await sql.query("select current_database() as db, current_user as role, version() as v", []);
  const row = ping[0] || ping;
  const v = String((row && row.v) || (row && row.version) || "").slice(0, 80);
  console.log("http_ok", "db=" + (row.db || row.current_database), "role=" + (row.role || row.current_user), "v=" + v);
} catch (e) {
  console.error("http_ping_fail", redact(e.message || e));
  process.exit(1);
}

for (const f of files) {
  await applyFile(f);
}
console.log("ALL_OK ms=" + (Date.now() - t0));
