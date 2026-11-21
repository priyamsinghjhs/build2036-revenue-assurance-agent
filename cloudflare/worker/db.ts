import type { SettlementListRow, SettlementRow, TransactionRow } from "./types";
import type { AppDb } from "./pg";
import {
  pandasToString,
  SETTLEMENT_COLUMNS,
  TRANSACTION_COLUMNS,
} from "./format";

export async function listSettlements(db: AppDb): Promise<SettlementListRow[]> {
  const { results } = await db
    .prepare(
      "SELECT settlement_id, expected_amount, settled_amount, status FROM settlements ORDER BY settlement_id",
    )
    .all<SettlementListRow>();
  return results ?? [];
}

export async function getSettlement(
  db: AppDb,
  settlementId: string,
): Promise<SettlementRow | null> {
  const row = await db
    .prepare("SELECT * FROM settlements WHERE settlement_id = ?")
    .bind(settlementId)
    .first<SettlementRow>();
  return row ?? null;
}

export async function getSettlementData(
  db: AppDb,
  settlementId: string,
): Promise<string | null> {
  const row = await getSettlement(db, settlementId);
  if (!row) return null;
  // app.py uses fetchdf().to_string() on a single-row result (index starts at 0).
  return pandasToString([row as unknown as Record<string, unknown>], SETTLEMENT_COLUMNS, {
    index: true,
    indexLabels: [0],
  });
}

export async function getRelatedTransactions(
  db: AppDb,
  settlementId: string,
): Promise<string> {
  // Same SQL as enrich_with_tools in src/graph.py (LIMIT 10, no ORDER BY).
  // Rows are inserted in txn_id order, so SQLite rowid order matches the Python frame.
  const { results } = await db
    .prepare("SELECT * FROM transactions WHERE settlement_id = ? LIMIT 10")
    .bind(settlementId)
    .all<TransactionRow>();
  return pandasToString(
    (results ?? []) as unknown as Record<string, unknown>[],
    TRANSACTION_COLUMNS,
    { index: false },
  );
}
