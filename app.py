"""Streamlit demo for Agentic Revenue Assurance Copilot."""
import streamlit as st
import duckdb
from src.data.init_db import DB_PATH, init_db
from src.graph import graph

st.set_page_config(page_title="Revenue Assurance Agent", layout="wide")
st.title("Agentic Revenue Assurance Copilot")
st.caption("BUILD 2036 — Applied AI & Agentic Intelligence | Open-source multi-agent system")

if not DB_PATH.exists():
    init_db()

# Load settlements for selection
if DB_PATH.exists():
    con = duckdb.connect(str(DB_PATH))
    settlements = con.execute("SELECT settlement_id, expected_amount, settled_amount, status FROM settlements").fetchdf()
    con.close()
else:
    st.warning("Database not found. Run: python src/data/init_db.py")
    settlements = None

col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("Select Case")
    if settlements is not None:
        selected = st.selectbox("Settlement", settlements["settlement_id"].tolist())
        if st.button("Run Investigation", type="primary"):
            with st.spinner("Agents investigating..."):
                # Get settlement data
                con = duckdb.connect(str(DB_PATH))
                data = con.execute(f"SELECT * FROM settlements WHERE settlement_id = '{selected}'").fetchdf().to_string()
                con.close()

                result = graph.invoke({
                    "settlement_id": selected,
                    "settlement_data": data,
                    "audit_trail": []
                })
                st.session_state["result"] = result

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
