# Agentic Revenue Assurance Copilot

**BUILD 2036 — Applied AI & Agentic Intelligence**

A fully open-source, multi-agent system that performs first-pass revenue assurance investigations for Treasury and Finance teams. Agents autonomously detect anomalies, investigate root causes, synthesize evidence, recommend actions, and generate CFO-ready audit trails.

**Zero cloud credits required.** Runs entirely locally with DuckDB + Ollama + LangGraph.

## Agents

| Agent | Responsibility |
|-------|----------------|
| **Anomaly Detector** | Flags fee variance, settlement mismatches, unexpected volume, delayed settlements using statistical rules + DuckDB |
| **Investigator** | Digs into root cause with SQL queries against DuckDB + RAG over contracts/fee schedules |
| **Evidence Synthesizer** | Builds structured case with numbers, timeline, and supporting evidence |
| **Recommendation Agent** | Proposes action (auto-adjust, dispute, escalate, mark known) + confidence score |
| **Auditor / Explainer** | Generates CFO-ready summary with full audit trail |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/priyamsinghjhs/build2036-revenue-assurance-agent.git
cd build2036-revenue-assurance-agent
pip install -r requirements.txt

# 2. Start Ollama and pull a model
ollama serve
ollama pull llama3.1:8b   # or qwen2.5:7b / mistral

# 3. Initialize synthetic data
python src/data/init_db.py

# 4. Run the demo
streamlit run app.py
```

## Architecture

```
Streamlit UI → LangGraph Multi-Agent Flow
                ├─ DuckDB (settlements, fees, transactions)
                ├─ Ollama (local LLM)
                └─ Chroma (RAG on contracts)
```

## Why This Fits BUILD 2036

- **Vertical AI Copilot** for Treasury/Finance revenue assurance
- **Multi-agent reasoning** with tool use, structured output, and auditability
- **Transforms decision-making**: first-pass investigation that currently takes hours of analyst time
- **2036 narrative**: By 2036, treasury teams will have agentic investigators instead of manual queues
- **Domain authenticity**: Inspired by real RADAR-style revenue assurance platforms

## Tech Stack (All Open Source)

- **Data**: DuckDB
- **LLM**: Ollama (Llama 3.1 / Qwen2.5 / Mistral)
- **Orchestration**: LangGraph
- **RAG**: Chroma + LlamaIndex-style retrieval
- **UI**: Streamlit
- **Anomaly**: pandas + scikit-learn statistical checks

## Project Structure

```
├── app.py                      # Streamlit demo
├── src/
│   ├── agents/                 # All 5 agents
│   ├── tools/                  # DuckDB + RAG tools
│   ├── graph.py                # LangGraph orchestration
│   └── data/init_db.py         # Synthetic data generator
├── requirements.txt
└── README.md
```

## Demo Flow

1. Select or paste a settlement / fee anomaly
2. Watch Anomaly Detector flag it
3. Investigator pulls related data + contract context
4. Evidence Synthesizer builds the case
5. Recommendation Agent proposes action + confidence
6. Auditor generates CFO-ready summary with full audit trail

Built for the **11th TiE Global Summit 2026 — BUILD 2036** hackathon.
