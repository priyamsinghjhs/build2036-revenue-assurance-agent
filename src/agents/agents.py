"""All five agents for the Revenue Assurance Copilot."""
import os

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

DEFAULT_OLLAMA_MODEL = "llama3.1:8b"
DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"
DEFAULT_TEMPERATURE = 0.1


def get_llm(provider: str | None = None):
    """Return a chat model selected by LLM_PROVIDER (or an explicit provider).

    Providers:
      - ollama (default): local ChatOllama with llama3.1:8b
      - cloudflare: ChatCloudflareWorkersAI on Workers AI
    """
    selected = (provider or os.getenv("LLM_PROVIDER", "ollama")).strip().lower()
    temperature = DEFAULT_TEMPERATURE

    if selected == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=DEFAULT_OLLAMA_MODEL, temperature=temperature)

    if selected == "cloudflare":
        from langchain_cloudflare.chat_models import ChatCloudflareWorkersAI

        kwargs = {
            "model": os.getenv("CLOUDFLARE_MODEL", DEFAULT_CLOUDFLARE_MODEL),
            "temperature": temperature,
            "request_timeout": 90,
            "max_retries": 1,
        }
        account_id = os.getenv("CF_ACCOUNT_ID")
        api_token = os.getenv("CF_AI_API_TOKEN")
        if account_id:
            kwargs["account_id"] = account_id
        if api_token:
            kwargs["api_token"] = api_token
        return ChatCloudflareWorkersAI(**kwargs)

    raise ValueError(
        f"Unsupported LLM_PROVIDER={selected!r}. Use 'ollama' or 'cloudflare'."
    )


llm = get_llm()

def anomaly_detector(state: dict) -> dict:
    """Detect anomalies in settlement data."""
    prompt = ChatPromptTemplate.from_template("""
You are the Anomaly Detector for Treasury Revenue Assurance.
Analyze the following settlement and flag any issues (fee variance, amount mismatch, delay, unexpected volume).

Settlement data:
{settlement}

Respond in this format:
ANOMALY: [yes/no]
TYPE: [fee_variance / settlement_mismatch / delayed / volume / none]
SEVERITY: [high / medium / low]
DESCRIPTION: [one sentence]
""")
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({"settlement": state.get("settlement_data", "")})
    state["anomaly_result"] = result
    state["audit_trail"] = state.get("audit_trail", []) + [f"Anomaly Detector: {result}"]
    return state

def investigator(state: dict) -> dict:
    """Investigate root cause using tools."""
    prompt = ChatPromptTemplate.from_template("""
You are the Investigator Agent. Dig into the root cause of this anomaly.

Anomaly:
{anomaly}

Related data from DuckDB:
{related_data}

Fee policy context:
{policy}

Provide a clear root-cause hypothesis with supporting evidence.
""")
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({
        "anomaly": state.get("anomaly_result", ""),
        "related_data": state.get("related_data", "No additional data"),
        "policy": state.get("policy_context", "")
    })
    state["investigation"] = result
    state["audit_trail"] = state.get("audit_trail", []) + [f"Investigator: {result[:500]}..."]
    return state

def evidence_synthesizer(state: dict) -> dict:
    """Synthesize structured evidence."""
    prompt = ChatPromptTemplate.from_template("""
You are the Evidence Synthesizer. Turn the investigation into a structured case.

Investigation findings:
{investigation}

Output:
- Timeline of events
- Key numbers (expected vs actual)
- Supporting evidence points
- Impact estimate
""")
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({"investigation": state.get("investigation", "")})
    state["evidence"] = result
    state["audit_trail"] = state.get("audit_trail", []) + ["Evidence Synthesizer completed structured case"]
    return state

def recommendation_agent(state: dict) -> dict:
    """Recommend action with confidence."""
    prompt = ChatPromptTemplate.from_template("""
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
""")
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({"evidence": state.get("evidence", "")})
    state["recommendation"] = result
    state["audit_trail"] = state.get("audit_trail", []) + [f"Recommendation: {result}"]
    return state

def auditor_explainer(state: dict) -> dict:
    """Generate CFO-ready summary with full audit trail."""
    prompt = ChatPromptTemplate.from_template("""
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
""")
    chain = prompt | llm | StrOutputParser()
    audit_text = "\n".join(state.get("audit_trail", []))
    result = chain.invoke({
        "evidence": state.get("evidence", ""),
        "recommendation": state.get("recommendation", ""),
        "audit_trail": audit_text
    })
    state["cfo_summary"] = result
    return state
