"""Streamlit demo for Agentic Revenue Assurance Copilot."""
import streamlit as st

from src.data.init_db import connect_readonly, ensure_db

st.set_page_config(page_title="Revenue Assurance Agent", layout="wide")

# Repair/create tables before any query. Do not key off file existence alone:
# duckdb.connect() creates an empty .db, which would skip init.
ensure_db()

# Import the graph after init so tool modules cannot observe an empty database.
from src.graph import graph  # noqa: E402

st.title("Agentic Revenue Assurance Copilot")
st.caption("BUILD 2036 — Applied AI & Agentic Intelligence | Open-source multi-agent system")

try:
    con = connect_readonly()
    try:
        settlements = con.execute(
            "SELECT settlement_id, expected_amount, settled_amount, status FROM settlements"
        ).fetchdf()
    finally:
        con.close()
except Exception as exc:
    st.error(f"Could not load settlements: {exc}")
    settlements = None

col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("Select Case")
    if settlements is not None and not settlements.empty:
        selected = st.selectbox("Settlement", settlements["settlement_id"].tolist())
        if st.button("Run Investigation", type="primary"):
            with st.spinner("Agents investigating..."):
                con = connect_readonly()
                try:
                    data = con.execute(
                        "SELECT * FROM settlements WHERE settlement_id = ?",
                        [selected],
                    ).fetchdf().to_string()
                finally:
                    con.close()

                result = graph.invoke({
                    "settlement_id": selected,
                    "settlement_data": data,
                    "audit_trail": []
                })
                st.session_state["result"] = result
    elif settlements is not None:
        st.warning("No settlements found. The database may need to be re-initialized.")

with col2:
    if "result" in st.session_state:
        r = st.session_state["result"]
        st.subheader("Investigation Results")

        tabs = st.tabs(["CFO Summary", "Recommendation", "Evidence", "Investigation", "Audit Trail"])

        with tabs[0]:
            st.markdown(r.get("cfo_summary", "No summary"))
        with tabs[1]:
            st.code(r.get("recommendation", ""))
        with tabs[2]:
            st.markdown(r.get("evidence", ""))
        with tabs[3]:
            st.markdown(r.get("investigation", ""))
        with tabs[4]:
            for step in r.get("audit_trail", []):
                st.text(step)

st.sidebar.markdown("""
### Agents
1. Anomaly Detector
2. Investigator
3. Evidence Synthesizer
4. Recommendation Agent
5. Auditor / Explainer

### Stack
- DuckDB
- Ollama (local) or Cloudflare Workers AI
- LangGraph
- Streamlit
""")
