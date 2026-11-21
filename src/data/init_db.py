"""Initialize DuckDB with synthetic treasury / revenue assurance data."""
import duckdb
import pandas as pd
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "revenue_assurance.db"

def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    con = duckdb.connect(str(DB_PATH))

    # Settlements
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

    # Transactions
    txns = pd.DataFrame({
        "txn_id": [f"TXN{i:05d}" for i in range(1, 101)],
        "settlement_id": [f"SET{(i%20)+1:04d}" for i in range(100)],
        "amount": [50 + (i%20)*10 for i in range(100)],
        "txn_date": pd.date_range("2026-10-25", periods=100, freq="h"),
        "type": ["sale" if i%5 != 0 else "refund" for i in range(100)]
    })
    con.execute("CREATE OR REPLACE TABLE transactions AS SELECT * FROM txns")

    # Fee schedule (for RAG)
    fee_docs = [
        {"id": "fee1", "text": "Standard merchant fee is 2.5% of gross volume. Volume tiers above $10k receive 2.2%."},
        {"id": "fee2", "text": "Settlement must occur within T+2. Delays beyond T+3 trigger investigation."},
        {"id": "fee3", "text": "Fee variance above 1.5 percentage points requires root-cause analysis and possible dispute."},
        {"id": "fee4", "text": "Refunds reduce net settlement. Expected net = gross - refunds - fees."}
    ]
    con.execute("CREATE OR REPLACE TABLE fee_documents AS SELECT * FROM fee_docs")

    print(f"Database initialized at {DB_PATH}")
    print(con.execute("SELECT COUNT(*) FROM settlements").fetchone())
    con.close()

if __name__ == "__main__":
    init_db()
