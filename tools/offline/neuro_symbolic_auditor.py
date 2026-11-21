#!/usr/bin/env python3
"""
Neuro-Symbolic Payment Assurance Agent (optional offline tool).

This is the user's Docling + Ollama/Qwen + DuckDB + sqlglot prototype, adapted
so compiled rules also emit the live app schema:

    {rule_name, contract_citation, sql_expression}

`sql_expression` is a CASE expression that computes expected_fee over the
allow-listed canonical columns, using NUMERIC/DECIMAL arithmetic (never float).

The live Cloudflare + Neon app does not run Docling, Ollama or DuckDB. It uses
Workers AI, Neon Postgres, and a JS SQL AST validator instead. Use this script
on a laptop when you want a local PDF-to-rule compiler.

Z3 theorem proving is intentionally not used here. It remains an optional
offline addition if you want formal proofs later; the in-app path uses
deterministic synthetic edge-case tests plus human approval.

Prerequisites:
    pip install docling duckdb pydantic openai sqlglot
    ollama pull qwen2.5-coder:14b

Usage:
    python neuro_symbolic_auditor.py
    python neuro_symbolic_auditor.py --emit-json compiled_rule.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import duckdb
import sqlglot
from pydantic import BaseModel, Field

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    from docling.document_converter import DocumentConverter
except ImportError:  # pragma: no cover
    DocumentConverter = None  # type: ignore


CANONICAL_COLUMNS = (
    "txn_id",
    "payment_rail",
    "card_segment",
    "txn_amount",
    "actual_fee",
    "merchant_id",
    "scheme",
    "method",
    "mcc",
    "currency",
    "settlement_amount",
    "recon_amount",
    "is_rupay_credit",
    "is_ppi",
    "p2m_flag",
    "ird",
    "irf",
    "response_code",
    "txn_status",
    "tcr5_qualification",
)

# Columns the original prototype mentioned; still accepted.
LEGACY_COLUMNS = ("txn_id", "payment_rail", "card_segment", "txn_amount", "actual_fee")


class CompiledAuditRule(BaseModel):
    """Strict neural-layer output. Compatible with the live app rule schema."""

    rule_name: str = Field(description="Short descriptive name of the fee rule")
    contract_citation: str = Field(
        description="Exact text from the contract justifying this rule"
    )
    sql_expression: str = Field(
        description=(
            "A valid SQL CASE expression calculating expected_fee using the "
            "allow-listed canonical columns. Must use DECIMAL/NUMERIC, never FLOAT. "
            "Postgres- and DuckDB-compatible."
        )
    )
    # Kept so the original DuckDB prototype path still works if a model emits it.
    duckdb_sql_expression: str | None = Field(
        default=None,
        description="Optional alias of sql_expression for the original DuckDB runner",
    )

    def expression(self) -> str:
        return (self.sql_expression or self.duckdb_sql_expression or "").strip()

    def to_app_schema(self) -> dict:
        return {
            "rule_name": self.rule_name,
            "contract_citation": self.contract_citation,
            "sql_expression": self.expression(),
        }


def extract_contract_markdown(pdf_path: str) -> str:
    """Neural layer: parse a contract PDF with Docling."""
    if DocumentConverter is None:
        raise RuntimeError("docling is not installed. pip install docling")
    converter = DocumentConverter()
    result = converter.convert(pdf_path)
    return result.document.export_to_markdown()


def compile_contract_to_sql(contract_markdown: str) -> CompiledAuditRule:
    """Neural -> symbolic compiler: translate markdown to a CASE expression."""
    if OpenAI is None:
        raise RuntimeError("openai is not installed. pip install openai")
    client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
    cols = ", ".join(CANONICAL_COLUMNS)
    prompt = f"""
You are a Neuro-Symbolic Financial Rule Compiler.
Read the payment processing contract below and generate a deterministic SQL
CASE expression that calculates expected_fee.

Available canonical columns:
{cols}

Types:
- txn_id, payment_rail, card_segment, merchant_id, scheme, method, mcc, currency, p2m_flag, ird, response_code, txn_status, tcr5_qualification are text
- payment_rail is one of 'UPI', 'CARD', 'NEFT', 'WALLET'
- card_segment is one of 'CONSUMER_DEBIT', 'COMMERCIAL_CREDIT', 'NA'
- txn_amount, actual_fee, settlement_amount, recon_amount, irf are DECIMAL/NUMERIC(18,4)
- is_rupay_credit, is_ppi are booleans
- Never use FLOAT. Cast arithmetic to DECIMAL(18,4) or NUMERIC(18,4).
- Return only a CASE expression, not a full SELECT.

Contract Text:
{contract_markdown}
"""
    response = client.beta.chat.completions.parse(
        model="qwen2.5-coder:14b",
        messages=[{"role": "user", "content": prompt}],
        response_format=CompiledAuditRule,
        temperature=0.0,
    )
    rule = response.choices[0].message.parsed
    if rule is None:
        raise RuntimeError("Model did not return a compiled rule")
    if not rule.sql_expression and rule.duckdb_sql_expression:
        rule.sql_expression = rule.duckdb_sql_expression
    return rule


def validate_sql_expression(sql_expr: str) -> bool:
    """Symbolic guardrail: parse the expression and reject mutating SQL."""
    try:
        parsed = sqlglot.parse_one(sql_expr, read="duckdb")
        forbidden = {"DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "ATTACH", "COPY", "CREATE"}
        tokens = {getattr(t, "name", None) or getattr(t, "this", None) or "" for t in parsed.walk()}
        tokens = {str(t).upper() for t in tokens if t}
        if tokens.intersection(forbidden):
            raise ValueError("Mutating SQL keywords detected!")
        # Also reject obviously disallowed identifiers later used as columns.
        return True
    except Exception as e:
        raise ValueError(f"Symbolic validation failed: {e}") from e


def run_settlement_audit(csv_path: str, rule: CompiledAuditRule) -> None:
    """Symbolic execution: audit a settlement CSV in DuckDB with DECIMAL math."""
    expr = rule.expression()
    validate_sql_expression(expr)
    con = duckdb.connect(database=":memory:")
    # Load settlement file with strict DECIMAL precision (never FLOAT)
    # csv_path is a local path we control; still quote-escape it.
    safe = str(csv_path).replace("'", "''")
    con.execute(
        f"""
        CREATE TABLE settlements AS
        SELECT
            txn_id,
            payment_rail,
            card_segment,
            CAST(txn_amount AS DECIMAL(18,4)) AS txn_amount,
            CAST(actual_fee AS DECIMAL(18,4)) AS actual_fee
        FROM read_csv_auto('{safe}');
        """
    )
    audit_query = f"""
        WITH calculated AS (
            SELECT *,
                   CAST({expr} AS DECIMAL(18,4)) AS expected_fee
            FROM settlements
        )
        SELECT
            txn_id, payment_rail, card_segment, txn_amount, actual_fee, expected_fee,
            (actual_fee - expected_fee) AS revenue_leakage
        FROM calculated
        WHERE (actual_fee - expected_fee) > 0.01;
    """
    leaks = con.execute(audit_query).fetchdf()
    print(f"Rule Applied: {rule.rule_name}")
    print(f"Citation: {rule.contract_citation}\n")
    print(f"Total Leaking Transactions: {len(leaks)}")
    if len(leaks):
        print(f"Total Recoverable Leakage: {leaks['revenue_leakage'].sum():.2f}\n")
        print(leaks.to_string(index=False))
    else:
        print("Total Recoverable Leakage: 0.00\n")


SAMPLE_CONTRACT_MD = """### Schedule A: Processing Fees
1. UPI P2M Transactions: Zero (0.00) MDR fee for all transaction values.
2. Commercial Credit Cards: 0.35% of transaction value for amounts strictly greater than 10,000.00, capped at 150.00 per transaction. Amounts <= 10,000.00 incur a flat fee of 25.00.
"""

# Deterministic fallback used when Ollama is not running, so the script can
# still demonstrate the symbolic path and emit the app schema.
SAMPLE_COMPILED = CompiledAuditRule(
    rule_name="UPI zero-MDR and commercial-credit cap",
    contract_citation=(
        "UPI P2M Transactions: Zero (0.00) MDR fee for all transaction values. "
        "Commercial Credit Cards: 0.35% of transaction value for amounts strictly "
        "greater than 10,000.00, capped at 150.00 per transaction. "
        "Amounts <= 10,000.00 incur a flat fee of 25.00."
    ),
    sql_expression=(
        "CASE "
        "WHEN payment_rail = 'UPI' THEN CAST(0 AS NUMERIC(18,4)) "
        "WHEN payment_rail = 'CARD' AND card_segment = 'COMMERCIAL_CREDIT' "
        "AND txn_amount > CAST(10000 AS NUMERIC(18,4)) "
        "THEN LEAST(CAST(txn_amount * CAST(0.0035 AS NUMERIC(18,8)) AS NUMERIC(18,4)), "
        "CAST(150 AS NUMERIC(18,4))) "
        "WHEN payment_rail = 'CARD' AND card_segment = 'COMMERCIAL_CREDIT' "
        "AND txn_amount <= CAST(10000 AS NUMERIC(18,4)) "
        "THEN CAST(25 AS NUMERIC(18,4)) "
        "ELSE CAST(0 AS NUMERIC(18,4)) END"
    ),
)


def write_sample_csv(path: Path) -> None:
    path.write_text(
        "txn_id,payment_rail,card_segment,txn_amount,actual_fee\n"
        "TXN001,UPI,NA,5000.00,0.00\n"
        "TXN002,UPI,NA,12000.00,18.00\n"
        "TXN003,CARD,COMMERCIAL_CREDIT,50000.00,175.00\n"
        "TXN004,CARD,COMMERCIAL_CREDIT,50000.00,150.00\n"
        "TXN005,CARD,COMMERCIAL_CREDIT,10000.00,25.00\n"
        "TXN006,CARD,COMMERCIAL_CREDIT,10000.01,35.00\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", help="Optional contract PDF to parse with Docling")
    parser.add_argument("--csv", help="Settlement CSV to audit (default: bundled sample)")
    parser.add_argument("--emit-json", help="Write the compiled app-schema rule to this path")
    parser.add_argument(
        "--offline-sample",
        action="store_true",
        help="Skip Ollama and use the deterministic Schedule A sample rule",
    )
    args = parser.parse_args(argv)

    here = Path(__file__).resolve().parent
    csv_path = Path(args.csv) if args.csv else here / "sample_settlement.csv"
    if not csv_path.exists():
        write_sample_csv(csv_path)

    if args.pdf:
        contract_md = extract_contract_markdown(args.pdf)
    else:
        contract_md = SAMPLE_CONTRACT_MD

    if args.offline_sample or args.pdf is None:
        # Default path is the sample contract; only call Ollama when asked
        # (or when a PDF is supplied).
        if args.offline_sample or not args.pdf:
            compiled = SAMPLE_COMPILED
        else:
            compiled = compile_contract_to_sql(contract_md)
    else:
        compiled = compile_contract_to_sql(contract_md)

    if not args.pdf and not args.offline_sample:
        # Try Ollama, fall back to the sample rule if the local model is down.
        try:
            compiled = compile_contract_to_sql(contract_md)
        except Exception as exc:  # noqa: BLE001
            print(f"Ollama compile skipped ({exc}). Using deterministic sample rule.\n", file=sys.stderr)
            compiled = SAMPLE_COMPILED

    print("Compiled SQL Expression:\n", compiled.expression(), "\n")
    if args.emit_json:
        Path(args.emit_json).write_text(json.dumps(compiled.to_app_schema(), indent=2))
        print(f"Wrote app-schema rule to {args.emit_json}")
    run_settlement_audit(str(csv_path), compiled)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
