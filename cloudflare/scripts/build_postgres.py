#!/usr/bin/env python3
"""Convert SQLite D1 migrations into a Neon/Postgres script. Local files only."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "migrations"
OUT = ROOT / "postgres"

HEADER = """-- Neon / Postgres port of the synthetic acquiring book.
-- Generated from cloudflare/migrations (SQLite/D1). Do not edit by hand.
-- Apply once: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres/001_schema_and_seed.sql
--          && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres/002_summaries.sql
-- All data is SYNTHETIC (is_synthetic = 1).

"""


def _skip_string_or_comment(sql: str, i: int) -> int | None:
    """Return index after a string or comment starting at i, else None."""
    n = len(sql)
    if sql.startswith("--", i):
        e = sql.find("\n", i)
        return n if e < 0 else e + 1
    if sql.startswith("/*", i):
        e = sql.find("*/", i + 2)
        return n if e < 0 else e + 2
    if sql[i] == "'":
        j = i + 1
        while j < n:
            if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                j += 2
                continue
            if sql[j] == "'":
                return j + 1
            j += 1
        return n
    if sql[i] == '"':
        j = i + 1
        while j < n:
            if sql[j] == '"':
                return j + 1
            j += 1
        return n
    if sql[i] == "$":
        import re
        m = re.match(r"\$[A-Za-z0-9_]*\$", sql[i:])
        if m:
            tag = m.group(0)
            e = sql.find(tag, i + len(tag))
            return n if e < 0 else e + len(tag)
    return None


def _split_call_args(sql: str, open_paren: int) -> tuple[list[str], int]:
    """Split function-call arguments starting at the '(' index. Returns (args, index after ')')."""
    assert sql[open_paren] == "("
    args: list[str] = []
    start = open_paren + 1
    i = start
    depth = 1
    n = len(sql)
    while i < n:
        skipped = _skip_string_or_comment(sql, i)
        if skipped is not None:
            i = skipped
            continue
        c = sql[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i])
                return args, i + 1
        elif c == "," and depth == 1:
            args.append(sql[start:i])
            start = i + 1
        i += 1
    args.append(sql[start:])
    return args, n


def rewrite_round(sql: str) -> str:
    """Postgres only has round(numeric, int). Cast the first arg of 2-arg ROUND()."""
    import re
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        skipped = _skip_string_or_comment(sql, i)
        if skipped is not None:
            out.append(sql[i:skipped])
            i = skipped
            continue
        m = re.match(r"ROUND\s*\(", sql[i:], flags=re.I)
        if not m:
            out.append(sql[i])
            i += 1
            continue
        open_paren = i + m.end() - 1
        args, end = _split_call_args(sql, open_paren)
        args = [rewrite_round(a) for a in args]
        if len(args) == 2:
            expr = args[0].strip()
            prec = args[1].strip()
            # Always cast: an inner ::numeric must not skip the outer ROUND().
            if not expr.lower().rstrip().endswith("::numeric"):
                expr = f"({expr})::numeric"
            out.append(f"ROUND({expr}, {prec})")
        else:
            out.append("ROUND(" + ",".join(args) + ")")
        i = end
    return "".join(out)


def transform(sql: str) -> str:
    sql = re.sub(r"(?im)^PRAGMA\b.*?;\s*", "", sql)
    sql = sql.replace("DATE(s.settlement_date)", "SUBSTR(s.settlement_date, 1, 10)")
    sql = re.sub(r"DATE\(([A-Za-z0-9_.]+)\)", r"SUBSTR(\1, 1, 10)", sql)
    sql = sql.replace("MAX(0, ", "GREATEST(0, ")
    sql = re.sub(
        r"CAST\(julianday\('2026-11-21'\) - julianday\(([A-Za-z0-9_.]+)\) AS INTEGER\)",
        r"(DATE '2026-11-21' - CAST(\1 AS date))",
        sql,
    )
    # FX rates: Postgres requires GROUP BY of source columns, not select aliases
    sql = sql.replace(
        """INSERT INTO ra_fx_rates (rate_id, ts, pair, mid_rate, provider, is_synthetic)
SELECT 'FXR-' || from_ccy || to_ccy || '-' || SUBSTR(ts, 1, 10),
       SUBSTR(ts, 1, 10), from_ccy || '/' || to_ccy, AVG(reference_rate), 'FXPRO', 1
FROM ra_fx_conversions
GROUP BY 1, 2, 3;""",
        """INSERT INTO ra_fx_rates (rate_id, ts, pair, mid_rate, provider, is_synthetic)
SELECT 'FXR-' || from_ccy || to_ccy || '-' || SUBSTR(ts, 1, 10),
       SUBSTR(ts, 1, 10), from_ccy || '/' || to_ccy, AVG(reference_rate), 'FXPRO', 1
FROM ra_fx_conversions
GROUP BY from_ccy, to_ccy, SUBSTR(ts, 1, 10);""",
    )
    # Safer view drops when tables are recreated
    # 0030 dropped these two views and did not recreate them. SQLite CREATE VIEW
    # does not require the base relation to exist; Postgres does, so keep them.
    sql = sql.replace(
        """DROP VIEW IF EXISTS v_ra_flow;

DROP VIEW IF EXISTS v_ra_auth_capture;

DROP VIEW IF EXISTS v_ra_capture_scheme;

DROP VIEW IF EXISTS v_ra_scheme_fee_var;
""",
        """DROP VIEW IF EXISTS v_ra_flow;

DROP VIEW IF EXISTS v_ra_capture_scheme;
""",
    )
    sql = rewrite_round(sql)
    return sql


def main() -> None:
    files = sorted(SRC.glob("*.sql"))
    parts = [HEADER, "BEGIN;\n"]
    for path in files:
        parts.append(f"\n-- ===== {path.name} =====\n")
        parts.append(transform(path.read_text()))
        if not parts[-1].endswith("\n"):
            parts.append("\n")
    parts.append("\nCOMMIT;\n")
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "001_schema_and_seed.sql"
    text = "".join(parts)
    dest.write_text(text)
    print(f"wrote {dest} ({len(text)} bytes, {text.count(chr(10))} lines, {len(files)} sources)")


if __name__ == "__main__":
    main()
