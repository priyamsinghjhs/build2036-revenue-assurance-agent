"""Simple RAG tool over fee schedules and contracts."""
from langchain_core.tools import tool

FEE_KNOWLEDGE = """
Fee Schedule & Contract Rules:
- Standard merchant fee rate is 2.5% of gross volume.
- Volume tiers above $10,000 receive reduced rate of 2.2%.
- Settlement window is T+2 business days. Delays beyond T+3 require investigation.
- Fee variance greater than 1.5 percentage points must be root-caused and may be disputed.
- Net settlement = Gross volume - Refunds - Fees.
- Known acceptable variances: rounding differences under 0.5%, timing differences within same day.
"""

@tool
def retrieve_fee_policy(query: str) -> str:
    """Retrieve relevant fee schedule rules, contract terms, or revenue assurance policies.
    Use this when investigating why a fee or settlement looks incorrect.
    """
    # Simple keyword-based retrieval for prototype (can be upgraded to Chroma)
    q = query.lower()
    if "fee" in q or "rate" in q or "variance" in q:
        return FEE_KNOWLEDGE
    if "settlement" in q or "delay" in q or "t+" in q:
        return FEE_KNOWLEDGE
    return FEE_KNOWLEDGE
