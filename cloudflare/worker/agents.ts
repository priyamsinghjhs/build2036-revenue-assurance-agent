import { getRelatedTransactions, getSettlementData } from "./db";
import { complete } from "./llm";
import {
  ANOMALY_TEMPLATE,
  AUDITOR_TEMPLATE,
  EVIDENCE_TEMPLATE,
  INVESTIGATOR_TEMPLATE,
  RECOMMENDATION_TEMPLATE,
  fill,
  retrieveFeePolicy,
} from "./prompts";
import type { AgentState, Env } from "./types";

export async function runAnomalyDetector(env: Env, settlementId: string): Promise<AgentState> {
  const settlementData = await getSettlementData(env.DB, settlementId);
  if (settlementData === null) {
    throw new NotFoundError(`Unknown settlement_id: ${settlementId}`);
  }
  const prompt = fill(ANOMALY_TEMPLATE, { settlement: settlementData });
  const result = await complete(env.AI, prompt);
  return {
    settlement_id: settlementId,
    settlement_data: settlementData,
    anomaly_result: result,
    audit_trail: [`Anomaly Detector: ${result}`],
  };
}

export async function runInvestigator(
  env: Env,
  state: Pick<AgentState, "settlement_id" | "anomaly_result" | "audit_trail">,
): Promise<AgentState> {
  const relatedData = await getRelatedTransactions(env.DB, state.settlement_id);
  const policy = retrieveFeePolicy("fee variance settlement rules");
  const prompt = fill(INVESTIGATOR_TEMPLATE, {
    anomaly: state.anomaly_result ?? "",
    related_data: relatedData || "No additional data",
    policy,
  });
  const result = await complete(env.AI, prompt);
  // Faithful to agents.py: always slice to 500 chars and append "...".
  return {
    ...state,
    related_data: relatedData,
    policy_context: policy,
    investigation: result,
    audit_trail: [...(state.audit_trail ?? []), `Investigator: ${result.slice(0, 500)}...`],
  };
}

export async function runEvidenceSynthesizer(
  env: Env,
  state: Pick<AgentState, "investigation" | "audit_trail">,
): Promise<Pick<AgentState, "evidence" | "audit_trail">> {
  const prompt = fill(EVIDENCE_TEMPLATE, {
    investigation: state.investigation ?? "",
  });
  const result = await complete(env.AI, prompt);
  return {
    evidence: result,
    audit_trail: [
      ...(state.audit_trail ?? []),
      "Evidence Synthesizer completed structured case",
    ],
  };
}

export async function runRecommendationAgent(
  env: Env,
  state: Pick<AgentState, "evidence" | "audit_trail">,
): Promise<Pick<AgentState, "recommendation" | "audit_trail">> {
  const prompt = fill(RECOMMENDATION_TEMPLATE, { evidence: state.evidence ?? "" });
  const result = await complete(env.AI, prompt);
  return {
    recommendation: result,
    audit_trail: [...(state.audit_trail ?? []), `Recommendation: ${result}`],
  };
}

export async function runAuditor(
  env: Env,
  state: Pick<AgentState, "evidence" | "recommendation" | "audit_trail">,
): Promise<Pick<AgentState, "cfo_summary">> {
  const auditText = (state.audit_trail ?? []).join("\n");
  const prompt = fill(AUDITOR_TEMPLATE, {
    evidence: state.evidence ?? "",
    recommendation: state.recommendation ?? "",
    audit_trail: auditText,
  });
  const result = await complete(env.AI, prompt);
  return { cfo_summary: result };
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
