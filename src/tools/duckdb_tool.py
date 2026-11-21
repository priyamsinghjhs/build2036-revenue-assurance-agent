"""DuckDB tool for agents to query revenue data."""
from langchain_core.tools import tool

from src.data.init_db import DB_PATH, connect_readonly, ensure_db


@tool
def query_duckdb(sql: str) -> str:
    """Execute a SQL query against the revenue assurance DuckDB database.
    Tables: settlements, transactions, fee_documents.
    Use this to investigate anomalies, pull related transactions, or check historical patterns.
    """
    try:
        ensure_db()
        con = connect_readonly()
        try:
            result = con.execute(sql).fetchdf()
            return result.to_string(index=False)
        finally:
            con.close()
    except Exception as e:
        return f"Query error: {str(e)}"


@tool
def get_settlement(settlement_id: str) -> str:
    """Get full details of a specific settlement."""
    sql = f"SELECT * FROM settlements WHERE settlement_id = '{settlement_id}'"
    return query_duckdb.invoke(sql)
