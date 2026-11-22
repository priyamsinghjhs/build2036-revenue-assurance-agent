# Offline neuro-symbolic auditor

Optional laptop tool. It is **not** required to run the live Revenue Assurance app.

This directory keeps the Python prototype that was shared for this batch (Docling to read a contract PDF, a local Qwen2.5-Coder model via Ollama to compile a rule, sqlglot to validate the SQL AST, and DuckDB to audit a settlement CSV with exact `DECIMAL` arithmetic). The script is adapted so a compiled rule is emitted in the same schema the live app uses:

```json
{
  "rule_name": "UPI zero-MDR and commercial-credit cap",
  "contract_citation": "exact clause text",
  "sql_expression": "CASE WHEN ... THEN CAST(... AS NUMERIC(18,4)) END"
}
```

`sql_expression` must be an expression only (typically a `CASE`) that computes `expected_fee` over the allow-listed canonical settlement columns. Arithmetic uses `DECIMAL`/`NUMERIC`, never float.

## Why this is offline

Docling, Ollama and DuckDB do not run on the Workers Free + Neon stack. The live app therefore uses:

- Synthetic contract text already stored in Neon (with pgvector retrieval)
- Workers AI to draft the same strict rule schema
- A JavaScript SQL parser that accepts only an expression AST, allow-listed columns and functions
- Postgres `NUMERIC(18,4)` execution under the `ra_readonly` role with a statement timeout
- Deterministic synthetic edge-case tests (threshold boundaries, cap hits, zero-MDR rails) plus human approval before a rule is activated

## Z3

A theorem prover such as Z3 is **not** part of the in-app path. It can be added later as an optional offline check if you want formal proofs against the compiled expression. Until then, activation requires passing the generated edge-case tests and a human approver.

## Prerequisites

```bash
pip install docling duckdb pydantic openai sqlglot
ollama pull qwen2.5-coder:14b
```

## Usage

```bash
# Deterministic sample contract + bundled CSV (no Ollama required)
python neuro_symbolic_auditor.py --offline-sample

# Emit the app schema for inspection or paste into the Contracts page
python neuro_symbolic_auditor.py --offline-sample --emit-json compiled_rule.json

# Local PDF + Ollama
python neuro_symbolic_auditor.py --pdf acquirer_agreement.pdf --csv settlements.csv
```

The bundled `sample_settlement.csv` includes a clean UPI row, a UPI row wrongly charged a fee, an uncapped commercial-credit leak, a capped commercial-credit row, and the 10,000.00 / 10,000.01 boundary cases.
