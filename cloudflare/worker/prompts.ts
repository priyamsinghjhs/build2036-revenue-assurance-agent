/**
 * Prompts copied faithfully from src/agents/agents.py ChatPromptTemplate strings
 * (including the leading/trailing newlines of the Python triple-quoted literals).
 */
export const ANOMALY_TEMPLATE = `
You are the Anomaly Detector for Treasury Revenue Assurance.
Analyze the following settlement and flag any issues (fee variance, amount mismatch, delay, unexpected volume).

Settlement data:
{settlement}

Respond in this format:
ANOMALY: [yes/no]
TYPE: [fee_variance / settlement_mismatch / delayed / volume / none]
SEVERITY: [high / medium / low]
DESCRIPTION: [one sentence]
`;

export const INVESTIGATOR_TEMPLATE = `
You are the Investigator Agent. Dig into the root cause of this anomaly.

Anomaly:
{anomaly}

Related data from DuckDB:
{related_data}

Fee policy context:
{policy}

Provide a clear root-cause hypothesis with supporting evidence.
`;

export const EVIDENCE_TEMPLATE = `
You are the Evidence Synthesizer. Turn the investigation into a structured case.

Investigation findings:
{investigation}

Output:
- Timeline of events
- Key numbers (expected vs actual)
- Supporting evidence points
- Impact estimate
`;

export const RECOMMENDATION_TEMPLATE = `
You are the Recommendation Agent for Treasury.

Evidence:
{evidence}

Propose ONE of these actions:
- auto_adjust (small known variance)
- raise_dispute (fee or amount error)
- escalate_to_treasury (material impact or unclear)
- mark_known_variance (acceptable timing/rounding)

Also give a confidence score (0-100) and one-sentence rationale.

Format:
ACTION: ...
CONFIDENCE: ...
RATIONALE: ...
`;

export const AUDITOR_TEMPLATE = `
You are the Auditor / Explainer. Generate a concise CFO-ready summary.

Include:
1. What happened (one paragraph)
2. Financial impact
3. Recommended action and confidence
4. Full audit trail of agent steps

Evidence: {evidence}
Recommendation: {recommendation}
Audit trail:
{audit_trail}
`;

/**
 * Same policy text as src/tools/rag_tool.py FEE_KNOWLEDGE, including
 * the leading newline of the Python literal. retrieve_fee_policy always
 * returns this (every keyword branch did in the original).
 */
export const FEE_KNOWLEDGE = `
Fee Schedule & Contract Rules:
- Standard merchant fee rate is 2.5% of gross volume.
- Volume tiers above $10,000 receive reduced rate of 2.2%.
- Settlement window is T+2 business days. Delays beyond T+3 require investigation.
- Fee variance greater than 1.5 percentage points must be root-caused and may be disputed.
- Net settlement = Gross volume - Refunds - Fees.
- Known acceptable variances: rounding differences under 0.5%, timing differences within same day.
`;

export function retrieveFeePolicy(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("fee") || q.includes("rate") || q.includes("variance")) {
    return FEE_KNOWLEDGE;
  }
  if (q.includes("settlement") || q.includes("delay") || q.includes("t+")) {
    return FEE_KNOWLEDGE;
  }
  return FEE_KNOWLEDGE;
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}
