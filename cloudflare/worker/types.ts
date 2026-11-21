export const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const TEMPERATURE = 0.1;
// Workers AI defaults max_tokens to 256, which would truncate evidence / CFO summaries.
export const MAX_TOKENS = 1024;

export type AiBinding = {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
};

export type Env = {
  AI: AiBinding;
  DB: D1Database;
  ASSETS: Fetcher;
};

export type SettlementListRow = {
  settlement_id: string;
  expected_amount: number;
  settled_amount: number;
  status: string;
};

export type SettlementRow = SettlementListRow & {
  merchant_id: string;
  settlement_date: string;
  fee_rate: number;
};

export type TransactionRow = {
  txn_id: string;
  settlement_id: string;
  amount: number;
  txn_date: string;
  type: string;
};

export type AgentState = {
  settlement_id: string;
  settlement_data?: string;
  anomaly_result?: string;
  related_data?: string;
  policy_context?: string;
  investigation?: string;
  evidence?: string;
  recommendation?: string;
  cfo_summary?: string;
  audit_trail: string[];
};
