"""DuckDB tool for agents to query revenue data."""
import duckdb
from pathlib import Path
from langchain_core.tools import tool

DB_PATH = Path(__file__).parent.parent.parent / "data" / "revenue_assurance.db"

@tool
def query_duckdb(sql: str) -> str:
    """Execute a SQL query against the revenue assurance DuckDB database.
    Tables: settlements, transactions, fee_documents.
    Use this to investigate anomalies, pull related transactions, or check historical patterns.
    """
    try:
        con = duckdb.connect(str(DB_PATH), read_only=True)
        result = con.execute(sql).fetchdf()
        con.close()
        return result.to_string(index=False)
    except Exception as e:
        return f"Query error: {str(e)}"

@tool
def get_settlement(settlement_id: str) -> str:
    """Get full details of a specific settlement."""
    sql = f"SELECT * FROM settlements WHERE settlement_id = '{settlement_id}'"
    return query_duckdb.invoke(sql)
