"""LangGraph orchestration for the multi-agent Revenue Assurance flow."""
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from src.agents.agents import (
    anomaly_detector, investigator, evidence_synthesizer,
    recommendation_agent, auditor_explainer
)
from src.tools.duckdb_tool import query_duckdb, get_settlement
from src.tools.rag_tool import retrieve_fee_policy

class AgentState(TypedDict):
    settlement_id: str
    settlement_data: str
    anomaly_result: str
    related_data: str
    policy_context: str
    investigation: str
    evidence: str
    recommendation: str
    cfo_summary: str
    audit_trail: list

def enrich_with_tools(state: AgentState) -> AgentState:
    """Pre-fetch related data and policy before Investigator."""
    sid = state.get("settlement_id", "")
    if sid:
        state["related_data"] = query_duckdb.invoke(
            f"SELECT * FROM transactions WHERE settlement_id = '{sid}' LIMIT 10"
        )
        state["policy_context"] = retrieve_fee_policy.invoke("fee variance settlement rules")
    return state

def build_graph():
    workflow = StateGraph(AgentState)

    workflow.add_node("anomaly_detector", anomaly_detector)
    workflow.add_node("enrich", enrich_with_tools)
    workflow.add_node("investigator", investigator)
    workflow.add_node("evidence_synthesizer", evidence_synthesizer)
    workflow.add_node("recommendation_agent", recommendation_agent)
    workflow.add_node("auditor_explainer", auditor_explainer)

    workflow.set_entry_point("anomaly_detector")
    workflow.add_edge("anomaly_detector", "enrich")
    workflow.add_edge("enrich", "investigator")
    workflow.add_edge("investigator", "evidence_synthesizer")
    workflow.add_edge("evidence_synthesizer", "recommendation_agent")
    workflow.add_edge("recommendation_agent", "auditor_explainer")
    workflow.add_edge("auditor_explainer", END)

    return workflow.compile()

graph = build_graph()
