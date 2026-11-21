"""Initialize DuckDB with synthetic treasury / revenue assurance data."""
from __future__ import annotations

import fcntl
import time
from pathlib import Path

import duckdb
import pandas as pd

# Repo root: src/data/init_db.py -> ../../..
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = REPO_ROOT / "data" / "revenue_assurance.db"
LOCK_PATH = REPO_ROOT / "data" / "revenue_assurance.db.lock"
REQUIRED_TABLES = ("settlements", "transactions", "fee_documents")


def _required_tables_present(con: duckdb.DuckDBPyConnection) -> bool:
    rows = con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    names = {row[0] for row in rows}
    return all(name in names for name in REQUIRED_TABLES)


def db_is_ready(path: Path = DB_PATH) -> bool:
    """Return True if the DB file exists and has the required tables."""
    try:
        if not path.exists() or path.stat().st_size == 0:
            return False
    except OSError:
        return False
    try:
        con = duckdb.connect(str(path), read_only=True)
        try:
            return _required_tables_present(con)
        finally:
            con.close()
    except Exception:
        return False


def _write_tables(con: duckdb.DuckDBPyConnection) -> None:
    settlements = pd.DataFrame({
        "settlement_id": [f"SET{i:04d}" for i in range(1, 21)],
        "merchant_id": [f"MER{i%5+1:03d}" for i in range(20)],
        "expected_amount": [1000 + i*50 for i in range(20)],
        "settled_amount": [1000 + i*50 - (i%4)*30 for i in range(20)],
        "settlement_date": pd.date_range("2026-11-01", periods=20, freq="D"),
        "status": ["settled"]*18 + ["delayed", "mismatch"],
        "fee_rate": [0.025 + (i%3)*0.005 for i in range(20)]
    })
    con.execute("CREATE OR REPLACE TABLE settlements AS SELECT * FROM settlements")

    txns = pd.DataFrame({
        "txn_id": [f"TXN{i:05d}" for i in range(1, 101)],
        "settlement_id": [f"SET{(i%20)+1:04d}" for i in range(100)],
        "amount": [50 + (i%20)*10 for i in range(100)],
        "txn_date": pd.date_range("2026-10-25", periods=100, freq="h"),
        "type": ["sale" if i%5 != 0 else "refund" for i in range(100)]
    })
    con.execute("CREATE OR REPLACE TABLE transactions AS SELECT * FROM txns")

    fee_docs = pd.DataFrame([
        {"id": "fee1", "text": "Standard merchant fee is 2.5% of gross volume. Volume tiers above $10k receive 2.2%."},
        {"id": "fee2", "text": "Settlement must occur within T+2. Delays beyond T+3 trigger investigation."},
        {"id": "fee3", "text": "Fee variance above 1.5 percentage points requires root-cause analysis and possible dispute."},
        {"id": "fee4", "text": "Refunds reduce net settlement. Expected net = gross - refunds - fees."}
    ])
    con.execute("CREATE OR REPLACE TABLE fee_documents AS SELECT * FROM fee_docs")



def _sidecar_paths(path: Path) -> list[Path]:
    return [Path(str(path) + suffix) for suffix in (".wal", ".tmp")]


def _remove_db_files(path: Path) -> None:
    path.unlink(missing_ok=True)
    for sidecar in _sidecar_paths(path):
        sidecar.unlink(missing_ok=True)


def _connect_writable() -> duckdb.DuckDBPyConnection:
    """Open the DB for writing, replacing a 0-byte or corrupt file if needed."""
    try:
        if DB_PATH.exists() and DB_PATH.stat().st_size == 0:
            _remove_db_files(DB_PATH)
        return duckdb.connect(str(DB_PATH))
    except Exception:
        _remove_db_files(DB_PATH)
        return duckdb.connect(str(DB_PATH))


def init_db() -> Path:
    """Create or replace synthetic tables. Concurrent calls are serialized with a file lock."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "a") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            # Another session may have finished init while we waited for the lock.
            if db_is_ready():
                return DB_PATH
            con = _connect_writable()
            try:
                _write_tables(con)
                print(f"Database initialized at {DB_PATH}")
                print(con.execute("SELECT COUNT(*) FROM settlements").fetchone())
            finally:
                con.close()
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    return DB_PATH


def ensure_db() -> Path:
    """Ensure the database exists and contains required tables; init if not."""
    if not db_is_ready():
        init_db()
    return DB_PATH


def connect_readonly(retries: int = 15, delay: float = 0.1):
    """Open a read-only connection, retrying if a writer briefly holds the file lock."""
    ensure_db()
    last_error: Exception | None = None
    for _ in range(retries):
        try:
            return duckdb.connect(str(DB_PATH), read_only=True)
        except Exception as exc:
            last_error = exc
            time.sleep(delay)
    raise last_error if last_error else RuntimeError("Could not open DuckDB in read-only mode")


if __name__ == "__main__":
    init_db()
