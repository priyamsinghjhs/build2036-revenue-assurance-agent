import { complete } from "./llm";
import { getDb, type AppDb } from "./pg";
import type { Env } from "./types";
import { startRun, runAgentStep, completeRun } from "./agentRunner";
import { normalizeAmount, normalizeConfidence } from "../shared/numbers";
import { canonicalReviewAmount, exceptionIdParts } from "../shared/reviewAmount";
import { networkRisk } from "./network";
import { compileExpectedFeeExpr, persistAndRunTests, loadRuleTests, validateFeeExpression } from "./sqlRule";
import { listSuggestionDecisions } from "./auditor";
import { AppError } from "../shared/errors";
import { isOutOfScopeQuestion, OUT_OF_SCOPE_MESSAGE } from "../shared/askScope";
import {
  ASK_SCHEMA_PROMPT,
  groundedAnswer,
  matchAskTemplate,
  normalizeQuestion,
  type AskTemplateHit,
} from "./askTemplates";

export async function evalQuality(db: AppDb) {
  try {
    const { results } = await db
      .prepare("SELECT * FROM v_ra_eval_quality ORDER BY unverified DESC, agent_id")
      .all<Record<string, unknown>>();
    const totals = await db
      .prepare(
        `SELECT COUNT(*)::int AS n,
                COALESCE(AVG(faithfulness),0) AS faithfulness,
                COUNT(*) FILTER (WHERE verification='unverified')::int AS unverified,
                COALESCE(SUM(retries),0)::int AS retries
         FROM ra_eval_scores`,
      )
      .first<Record<string, unknown>>();
    return {
      agents: results ?? [],
      totals: {
        n: Number(totals?.n ?? 0),
        faithfulness: Number(totals?.faithfulness ?? 0),
        unverified: Number(totals?.unverified ?? 0),
        retries: Number(totals?.retries ?? 0),
      },
      note: "Runtime scores come from a deterministic grounding check (no extra LLM judge, to stay within the free neuron budget). A DeepEval suite with a Workers AI judge is available offline and in CI.",
    };
  } catch {
    return { agents: [], totals: { n: 0, faithfulness: 0, unverified: 0, retries: 0 }, note: "Eval scores are not available yet." };
  }
}

export async function intelOverview(db: AppDb) {

  const kpi = await db.prepare("SELECT * FROM ra_intel_kpi WHERE id = 1").first<Record<string, unknown>>();
  const reviews = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT DISTINCT exception_id FROM v_ra_review_queue WHERE review_status = 'pending'
       ) q`,
    )
    .first<{ n: number }>();
  return { ...(kpi ?? {}), reviews_pending: reviews?.n ?? 0 };
}

export async function listDocuments(db: AppDb) {
  const { results: docs } = await db
    .prepare(
      `SELECT d.doc_id, d.kind, d.title, d.party, d.effective_from, d.effective_to,
              (SELECT COUNT(*) FROM ra_document_chunks c WHERE c.doc_id=d.doc_id)::int AS chunks,
              (SELECT COUNT(*) FROM ra_extracted_rules r WHERE r.doc_id=d.doc_id)::int AS rules,
              (SELECT COUNT(*) FROM ra_extracted_rules r WHERE r.doc_id=d.doc_id AND r.status='approved')::int AS approved
       FROM ra_documents d ORDER BY d.kind, d.title`,
    )
    .all<Record<string, unknown>>();
  const { results: rules } = await db
    .prepare(
      `SELECT r.*, COALESCE((SELECT leakage FROM v_ra_contracts c WHERE c.recon_ref=r.rule_id LIMIT 1),0) AS impact
       FROM ra_extracted_rules r
       ORDER BY CASE r.status WHEN 'extracted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.party`,
    )
    .all<Record<string, unknown>>();
  const { results: impact } = await db
    .prepare("SELECT category, merchant_id, leakage, recon_ref, expected_amount, actual_amount FROM v_ra_contracts WHERE leakage>0.5 ORDER BY leakage DESC")
    .all<Record<string, unknown>>();
  return { documents: docs ?? [], rules: rules ?? [], impact: impact ?? [] };
}

export async function getDocument(db: AppDb, id: string) {
  const doc = await db.prepare("SELECT * FROM ra_documents WHERE doc_id = ?").bind(id).first<Record<string, unknown>>();
  if (!doc) return null;
  const { results: chunks } = await db
    .prepare("SELECT chunk_id, chunk_no, heading, clause_ref, body, (embedding IS NOT NULL) AS embedded FROM ra_document_chunks WHERE doc_id=? ORDER BY chunk_no")
    .bind(id)
    .all<Record<string, unknown>>();
  const { results: rules } = await db
    .prepare("SELECT * FROM ra_extracted_rules WHERE doc_id=? ORDER BY rule_id")
    .bind(id)
    .all<Record<string, unknown>>();
  return { document: doc, chunks: chunks ?? [], rules: rules ?? [] };
}

export async function decideRule(db: AppDb, ruleId: string, status: "approved" | "rejected", who: string) {
  if (status === "approved") {
    const row = await db.prepare("SELECT tests_passed, sql_expression FROM ra_extracted_rules WHERE rule_id=?").bind(ruleId).first<{ tests_passed: number; sql_expression: string }>();
    if (!row) throw new AppError("Rule not found", 404);
    if (!row.sql_expression) throw new Error("Rule has no validated sql_expression");
    if (!Number(row.tests_passed)) throw new Error("Rule must pass synthetic edge-case tests before activation");
  }
  await db
    .prepare("UPDATE ra_extracted_rules SET status=?, approved_by=?, approved_at=now() WHERE rule_id=?")
    .bind(status, who, ruleId)
    .run();
  try { await db.prepare("SELECT refresh_ra_summaries()").run(); } catch { /* summaries may lag */ }
  return db.prepare("SELECT * FROM ra_extracted_rules WHERE rule_id=?").bind(ruleId).first();
}

export async function extractContractRules(env: Env, docId: string) {
  const db = getDb(env);
  const doc = await getDocument(db, docId);
  if (!doc?.document) throw new Error("Document not found");
  const body = String(doc.document.body_markdown ?? "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("RULE:"))
    .join("\n")
    .slice(0, 6000);
  const raw = await complete(
    env.AI,
    `Extract contractual fee rules from this SYNTHETIC document as JSON only. Each rule MUST follow this strict schema: {"rules":[{"rule_name":"","contract_citation":"exact clause text","sql_expression":"CASE ... END","party":"","fee_type":"","rate":0,"unit":"bps|pct","threshold":null,"cap":null,"flat_fee":null,"effective_from":"YYYY-MM-DD","effective_to":null,"conditions":""}]}. sql_expression must be a CASE (or CAST) expression computing expected_fee over allow-listed columns only: txn_id, payment_rail, card_segment, txn_amount, actual_fee, merchant_id, scheme, method, mcc, currency, settlement_amount, recon_amount, de4_amount, de5_amount, is_rupay_credit, is_ppi, p2m_flag, ird, irf, response_code, txn_status, tcr5_qualification. Use NUMERIC/DECIMAL, never FLOAT. Do not invent parties or rates that are not in the text.\n\nDOCUMENT ${docId}:\n${body}`,
  );
  let parsed: { rules?: Record<string, unknown>[] } = {};
  try {
    const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  } catch {
    parsed = { rules: [] };
  }
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  const inserted: { rule_id: string; validation?: string; tests_passed?: boolean }[] = [];
  let i = 0;
  for (const r of rules) {
    i += 1;
    const id = `RULE-LLM-${docId}-${String(i).padStart(2, "0")}`;
    const chunk = (doc.chunks as Record<string, unknown>[])[0];
    const structured = {
      rule_id: id,
      rule_name: String(r.rule_name ?? r.fee_type ?? "rule"),
      fee_type: String(r.fee_type ?? "unknown"),
      rate: r.rate == null ? null : Number(r.rate),
      unit: String(r.unit ?? "bps"),
      threshold: r.threshold == null ? null : Number(r.threshold),
      cap: r.cap == null ? null : Number(r.cap),
      flat_fee: r.flat_fee == null ? null : Number(r.flat_fee),
    };
    let expr = String(r.sql_expression ?? "").trim();
    const citation = String(r.contract_citation ?? r.citation ?? "").slice(0, 800);
    if (!expr) expr = compileExpectedFeeExpr(structured);
    const valid = validateFeeExpression(expr);
    if (!valid.ok) {
      expr = compileExpectedFeeExpr(structured);
    }
    const recheck = validateFeeExpression(expr);
    await db
      .prepare(
        `INSERT INTO ra_extracted_rules (
           rule_id, doc_id, chunk_id, party, fee_type, rate, unit, previous_rate, threshold, cap, flat_fee,
           effective_from, effective_to, conditions, citation, rule_name, sql_expression, status, source, is_synthetic, tests_passed
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, 'extracted', 'llm', 1, 0)
         ON CONFLICT (rule_id) DO UPDATE SET rate=EXCLUDED.rate, citation=EXCLUDED.citation, conditions=EXCLUDED.conditions,
           rule_name=EXCLUDED.rule_name, sql_expression=EXCLUDED.sql_expression, cap=EXCLUDED.cap, flat_fee=EXCLUDED.flat_fee, source='llm'`,
      )
      .bind(
        id,
        docId,
        chunk?.chunk_id ?? null,
        String(r.party ?? ""),
        structured.fee_type,
        structured.rate,
        structured.unit,
        structured.threshold,
        structured.cap,
        structured.flat_fee,
        r.effective_from ? String(r.effective_from) : null,
        r.effective_to ? String(r.effective_to) : null,
        JSON.stringify({ conditions: r.conditions ?? "", citation }),
        citation,
        structured.rule_name,
        recheck.ok ? recheck.sql : expr,
      )
      .run();
    let tests_passed = false;
    if (recheck.ok) {
      try {
        const ran = await persistAndRunTests(env, db, id, structured, recheck.sql);
        tests_passed = ran.passed;
      } catch (err) {
        inserted.push({ rule_id: id, validation: err instanceof Error ? err.message : String(err), tests_passed: false });
        continue;
      }
    }
    inserted.push({ rule_id: id, validation: recheck.ok ? "ok" : recheck.error, tests_passed });
  }
  return { document_id: docId, raw, inserted, count: inserted.length };
}

export async function testRule(env: Env, ruleId: string) {
  const db = getDb(env);
  const row = await db.prepare("SELECT * FROM ra_extracted_rules WHERE rule_id=?").bind(ruleId).first<Record<string, unknown>>();
  if (!row) throw new Error("Rule not found");
  const structured = {
    rule_id: ruleId,
    rule_name: String(row.rule_name ?? ""),
    fee_type: String(row.fee_type ?? ""),
    rate: row.rate == null ? null : Number(row.rate),
    unit: row.unit == null ? null : String(row.unit),
    threshold: row.threshold == null ? null : Number(row.threshold),
    cap: row.cap == null ? null : Number(row.cap),
    flat_fee: row.flat_fee == null ? null : Number(row.flat_fee),
    previous_rate: row.previous_rate == null ? null : Number(row.previous_rate),
  };
  let expr = String(row.sql_expression ?? "").trim() || compileExpectedFeeExpr(structured);
  const valid = validateFeeExpression(expr);
  if (!valid.ok) throw new Error(valid.error);
  const ran = await persistAndRunTests(env, db, ruleId, structured, valid.sql);
  return { rule_id: ruleId, sql_expression: valid.sql, ...ran, note: "Z3 is not used in-app; it remains an optional offline prover. Activation requires these tests plus human approval." };
}

export async function ruleTests(env: Env, ruleId: string) {
  const db = getDb(env);
  const existing = await loadRuleTests(db, ruleId);
  if (existing.length) return { rule_id: ruleId, tests: existing, note: "Z3 is not used in-app; it remains an optional offline prover." };
  return testRule(env, ruleId);
}


export async function retrieveChunks(env: Env, query: string) {
  const db = getDb(env);
  // Hybrid retrieval: Postgres full-text (BM25-ish ts_rank) + optional pgvector,
  // then an optional @cf/baai/bge-reranker-base pass. Chunks are clause-sized
  // (~400–600 characters with heading overlap) in the seed documents.
  const qlike = `%${query.slice(0, 80)}%`;
  const { results: fts } = await db
    .prepare(
      `SELECT chunk_id, doc_id, heading, clause_ref, body,
              ts_rank(fts, plainto_tsquery('simple', ?)) AS score
       FROM ra_document_chunks
       WHERE fts @@ plainto_tsquery('simple', ?)
          OR body ILIKE ? OR heading ILIKE ?
       ORDER BY score DESC NULLS LAST
       LIMIT 12`,
    )
    .bind(query.slice(0, 200), query.slice(0, 200), qlike, qlike)
    .all<Record<string, unknown>>()
    .catch(async () => {
      return db
        .prepare("SELECT chunk_id, doc_id, heading, clause_ref, body, 0.0 AS score FROM ra_document_chunks WHERE body ILIKE ? OR heading ILIKE ? LIMIT 12")
        .bind(qlike, qlike)
        .all<Record<string, unknown>>();
    });
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of fts ?? []) merged.set(String(row.chunk_id), { ...row, source: "fts" });
  try {
    const have = await db.prepare("SELECT COUNT(*)::int AS n FROM ra_document_chunks WHERE embedding IS NOT NULL").first<{ n: number }>();
    if ((have?.n ?? 0) > 0) {
      const vec = await embedQuery(env, query);
      const { results: vecRows } = await db
        .prepare(
          `SELECT chunk_id, doc_id, heading, clause_ref, body, 1 - (embedding <=> ?::vector) AS score
           FROM ra_document_chunks WHERE embedding IS NOT NULL
           ORDER BY embedding <=> ?::vector LIMIT 12`,
        )
        .bind(vec, vec)
        .all<Record<string, unknown>>();
      for (const row of vecRows ?? []) {
        const id = String(row.chunk_id);
        const prev = merged.get(id);
        merged.set(id, prev ? { ...prev, score: Math.max(Number(prev.score ?? 0), Number(row.score ?? 0)), source: "hybrid" } : { ...row, source: "vector" });
      }
    }
  } catch {
    /* embeddings optional */
  }
  let chunks = [...merged.values()].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)).slice(0, 12);
  let method = "hybrid";
  if (chunks.length >= 3) {
    try {
      const result = await env.AI.run("@cf/baai/bge-reranker-base", {
        query,
        contexts: chunks.map((c) => ({ text: String(c.body ?? "").slice(0, 800) })),
      });
      const rec = result as Record<string, unknown>;
      const ranked = (Array.isArray(rec.response) ? rec.response : Array.isArray(rec.result) ? rec.result : Array.isArray(rec.data) ? rec.data : []) as Record<string, unknown>[];
      if (ranked.length) {
        const byIndex = new Map<number, number>();
        ranked.forEach((row, i) => {
          const idx = Number(row.id ?? row.index ?? i);
          const score = Number(row.score ?? row.relevance ?? row.relevance_score ?? 0);
          byIndex.set(idx, score);
        });
        chunks = chunks
          .map((c, i) => ({ ...c, score: byIndex.has(i) ? byIndex.get(i) : Number(c.score ?? 0) }))
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
        method = "hybrid+rerank";
      }
    } catch {
      /* reranker is optional and shares the free neuron budget */
    }
  }
  return { method, chunks: chunks.slice(0, 6), note: "Hybrid Postgres full-text + pgvector, optional bge-reranker-base. Clause-sized chunks (~400–600 characters)." };
}

async function embedQuery(env: Env, text: string): Promise<string> {
  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [text.slice(0, 2000)] });
  const rec = result as Record<string, unknown>;
  let arr: number[] | undefined;
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    arr = Array.isArray(first) ? (first as number[]) : Array.isArray((first as { embedding?: number[] })?.embedding)
      ? (first as { embedding: number[] }).embedding
      : undefined;
  }
  if (!arr && Array.isArray((rec as { embedding?: number[] }).embedding)) arr = (rec as { embedding: number[] }).embedding;
  if (!arr) throw new Error("embedding failed");
  return `[${arr.join(",")}]`;
}

export async function listAnomalies(db: AppDb) {
  const { results: events } = await db
    .prepare(
      `SELECT * FROM ra_anomaly_events
        WHERE status IN ('open', 'investigated')
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, ABS(COALESCE(zscore,0)) DESC, impact DESC`,
    )
    .all<Record<string, unknown>>();
  const open_count = (events ?? []).filter((e) => e.status === "open").length;
  const { results: series } = await db
    .prepare(
      `SELECT metric, segment, to_char(day,'YYYY-MM-DD') AS day, value, ewma, band_lo, band_hi, zscore, is_anomaly, volume
       FROM ra_metric_daily ORDER BY metric, segment, day`,
    )
    .all<Record<string, unknown>>();
  return {
    events: events ?? [],
    open_count,
    series: series ?? [],
    note: "Featured events combine the four injected z-score/EWMA seeds (UPI approval, ICICI settlement latency, Visa fee ratio, book-wide refund/CB) with isolation-forest flags on settlement fee ratios and FX markup (metric iforest_settlement / iforest_fx). Refresh is idempotent by (metric, segment, day) and does not re-open investigated, resolved, or acknowledged events. An sklearn MLP autoencoder is trained offline; reconstruction error is stored in Neon and is not scored in the Worker. Isolation-forest trees are also exported for single-row scoring in the Worker.",
  };
}

export async function investigateAnomaly(env: Env, eventId?: string) {
  const db = getDb(env);
  const ev = eventId
    ? await db.prepare("SELECT * FROM ra_anomaly_events WHERE event_id=?").bind(eventId).first<Record<string, unknown>>()
    : await db.prepare("SELECT * FROM ra_anomaly_events WHERE status='open' ORDER BY ABS(COALESCE(zscore,0)) DESC LIMIT 1").first<Record<string, unknown>>();
  if (!ev) return { skipped: true };
  const exceptionId = `anomalies:${ev.metric}:${String(ev.event_id).replace(/^ANOM-/, "")}`;
  const run = await startRun(db, `exception:${exceptionId}`);
  for (const agentId of ["investigator", "action", "auditor"] as const) {
    await runAgentStep(env, { runId: run.run_id, agentId, scope: `exception:${exceptionId}`, domain: "anomalies", exceptionId });
  }
  await completeRun(db, run.run_id);
  await db.prepare("UPDATE ra_anomaly_events SET investigated_run=?, status='investigated' WHERE event_id=?").bind(run.run_id, ev.event_id).run();
  return { skipped: false, event_id: ev.event_id, exception_id: exceptionId, run_id: run.run_id };
}

export async function routingSummary(db: AppDb) {
  const { results: policies } = await db.prepare("SELECT * FROM ra_routing_sim ORDER BY policy").all<Record<string, unknown>>();
  const { results: segments } = await db
    .prepare("SELECT * FROM ra_routing_sim_segments WHERE policy='thompson' ORDER BY segment_kind, fee_savings DESC")
    .all<Record<string, unknown>>();
  const retry = await db.prepare("SELECT * FROM ra_retry_sim WHERE policy='thompson_retry'").first<Record<string, unknown>>();
  const { results: arms } = await db.prepare("SELECT * FROM ra_retry_sim_arms WHERE policy='thompson_retry' ORDER BY arm").all<Record<string, unknown>>();
  return {
    synthetic: true,
    simulation: true,
    policies: policies ?? [],
    segments: segments ?? [],
    note: "Simulation on the synthetic October 2026 book. Counterfactual approval rates use historical segment rates (model-based offline replay of epsilon-greedy and Thompson sampling), not live traffic. Negative fee savings mean the higher-approval route is slightly more expensive in acquirer bps. The retry block is a separate fee-aware Thompson-style replay on soft declines (timing / alternate acquirer / network token); also not live traffic.",
    retry: retry ?? null,
    retry_arms: arms ?? [],
  };
}

export async function runRoutingSim(db: AppDb) {
  await db.prepare("SELECT refresh_ra_v7()").run();
  return routingSummary(db);
}

export async function listCases(db: AppDb) {
  const { results } = await db
    .prepare(
      `SELECT c.*, (SELECT e.exception_id FROM ra_case_exceptions e WHERE e.case_id=c.case_id LIMIT 1) AS exception_id
       FROM ra_cases c
       ORDER BY CASE c.status WHEN 'investigating' THEN 0 WHEN 'awaiting_approval' THEN 1 WHEN 'new' THEN 2 ELSE 3 END, c.leakage DESC`,
    )
    .all<Record<string, unknown>>();
  return { cases: results ?? [] };
}

export async function getCase(db: AppDb, id: string) {
  const row = await db.prepare("SELECT * FROM ra_cases WHERE case_id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const { results: exceptions } = await db.prepare("SELECT exception_id FROM ra_case_exceptions WHERE case_id=?").bind(id).all<{ exception_id: string }>();
  const { results: events } = await db.prepare("SELECT * FROM ra_case_events WHERE case_id=? ORDER BY ts").bind(id).all<Record<string, unknown>>();
  const { results: drafts } = await db.prepare("SELECT * FROM ra_outbound_drafts WHERE case_id=? ORDER BY draft_id").bind(id).all<Record<string, unknown>>();
  return { case: row, exceptions: (exceptions ?? []).map((e) => e.exception_id), events: events ?? [], drafts: drafts ?? [] };
}

export async function updateCase(db: AppDb, id: string, patch: { status?: string; owner?: string; comment?: string; actor?: string }) {
  if (patch.status) {
    await db
      .prepare("UPDATE ra_cases SET status=?, resolved_at=CASE WHEN ?='resolved' THEN now() ELSE resolved_at END WHERE case_id=?")
      .bind(patch.status, patch.status, id)
      .run();
  }
  if (patch.owner) await db.prepare("UPDATE ra_cases SET owner=? WHERE case_id=?").bind(patch.owner, id).run();
  if (patch.comment || patch.status || patch.owner) {
    await db
      .prepare("INSERT INTO ra_case_events (event_id, case_id, ts, actor, kind, body) VALUES (?, ?, now(), ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        id,
        patch.actor ?? "Priyam Singh",
        patch.comment ? "comment" : patch.status ? "status" : "assignment",
        patch.comment || `Status set to ${patch.status ?? ""} ${patch.owner ? "owner " + patch.owner : ""}`.trim(),
      )
      .run();
  }
  return getCase(db, id);
}

export async function listReviews(db: AppDb) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ON (q.exception_id)
              q.run_id, q.exception_id, q.domain, q.started_at, q.completed_at,
              q.auditor_json, q.investigator_json, q.action_json, q.review_status,
              q.decision, q.decided_at, q.reviewer,
              e.merchant_id, e.category, e.leakage, e.expected_amount, e.actual_amount,
              (e.ref_id IS NOT NULL) AS has_exception
       FROM v_ra_review_queue q
       LEFT JOIN ra_exception_rows e
         ON e.area || ':' || e.category || ':' || e.ref_id = q.exception_id
       ORDER BY q.exception_id, q.started_at DESC`,
    )
    .all<Record<string, unknown>>();
  const rows: Record<string, unknown>[] = (results ?? []).map((r) => {
    const hasException = r.has_exception === true || r.has_exception === 1 || r.has_exception === "t" || r.leakage != null;
    return {
      ...r,
      amount: canonicalReviewAmount({ leakage: r.leakage, hasException, action: r.action_json }),
    };
  });
  const pending = rows.filter((r) => r.review_status === "pending");
  const decided = rows.filter((r) => r.review_status !== "pending");
  return { pending, decided, count: pending.length };
}

export async function getReview(db: AppDb, id: string) {
  const decoded = decodeURIComponent(id);
  const row = await db
    .prepare(
      `SELECT * FROM v_ra_review_queue
       WHERE run_id = ? OR exception_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(decoded, decoded)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const exId = String(row.exception_id);
  const parts = exceptionIdParts(exId);
  const exception = parts
    ? await db
        .prepare(
          `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
                  area||':'||category||':'||ref_id AS exception_id
           FROM ra_exception_rows
           WHERE area = ? AND category = ? AND ref_id = ?
           LIMIT 1`,
        )
        .bind(parts.area, parts.category, parts.ref_id)
        .first<Record<string, unknown>>()
    : await db
        .prepare(
          `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
                  area||':'||category||':'||ref_id AS exception_id
           FROM ra_exception_rows
           WHERE area||':'||category||':'||ref_id = ?
           LIMIT 1`,
        )
        .bind(exId)
        .first<Record<string, unknown>>();
  if (row && exception) {
    row.merchant_id = exception.merchant_id;
    row.category = exception.category;
    row.leakage = exception.leakage;
    row.amount = canonicalReviewAmount({ leakage: exception.leakage, hasException: true, action: row.action_json });
  } else if (row) {
    row.amount = canonicalReviewAmount({ hasException: false, action: row.action_json });
  }
  const linkedCase = await db
    .prepare("SELECT c.* FROM ra_cases c JOIN ra_case_exceptions e ON e.case_id=c.case_id WHERE e.exception_id=? LIMIT 1")
    .bind(exId)
    .first<Record<string, unknown>>();
  const suggestion_decisions = await listSuggestionDecisions(db, exId);
  return { review: row, exception, case: linkedCase, suggestion_decisions };
}

export async function submitReview(
  env: Env,
  id: string,
  body: { decision: "approved" | "rejected" | "reinvestigate"; comment: string; amount_override?: number; reviewer?: string },
) {
  if (!body.comment || !body.comment.trim()) throw new AppError("A comment is required", 400);
  if (!["approved", "rejected", "reinvestigate"].includes(body.decision)) throw new AppError("Invalid decision", 400);
  const db = getDb(env);
  const current = await getReview(db, id);
  if (!current?.review) throw new AppError("Review item not found", 404);
  const exceptionId = String(current.review.exception_id);
  const runId = String(current.review.run_id);
  const reviewer = body.reviewer;
  if (!reviewer) throw new AppError("A signed-in reviewer is required", 401);
  const reviewId = crypto.randomUUID();
  const amount = body.amount_override != null ? normalizeAmount(body.amount_override) : normalizeAmount((current.exception as { leakage?: number } | null)?.leakage ?? 0);
  const actionStatus = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : "proposed";
  const actionId = crypto.randomUUID();
  if (body.decision !== "reinvestigate") {
    await db
      .prepare(
        `INSERT INTO ra_action_queue (action_id, run_id, exception_id, action, amount, currency, confidence, rationale, status, created_at, decided_at, decision_note)
         VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, now(), ?)`,
      )
      .bind(
        actionId,
        runId,
        exceptionId,
        body.decision === "approved" ? "approve_recommendation" : "reject_recommendation",
        amount,
        normalizeConfidence(90),
        body.comment.trim(),
        actionStatus,
        new Date().toISOString(),
        body.comment.trim(),
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO ra_review_decisions (review_id, run_id, exception_id, decision, comment, amount_override, reviewer, decided_at, action_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, now(), ?)`,
    )
    .bind(reviewId, runId, exceptionId, body.decision, body.comment.trim(), body.amount_override ?? null, reviewer, body.decision === "reinvestigate" ? null : actionId)
    .run();
  const caseId = (current.case as { case_id?: string } | null)?.case_id;
  if (caseId) {
    await db
      .prepare("INSERT INTO ra_case_events (event_id, case_id, ts, actor, kind, body) VALUES (?, ?, now(), ?, 'status', ?)")
      .bind(
        crypto.randomUUID(),
        caseId,
        reviewer,
        `Human review ${body.decision} on ${exceptionId}. ${body.comment.trim()}${body.amount_override != null ? " Amount override ₹" + amount : ""}`,
      )
      .run();
    if (body.decision === "approved") {
      await db.prepare("UPDATE ra_cases SET status='resolved', resolved_at=now() WHERE case_id=?").bind(caseId).run();
    } else if (body.decision === "reinvestigate") {
      await db.prepare("UPDATE ra_cases SET status='investigating' WHERE case_id=?").bind(caseId).run();
    }
  }
  await db
    .prepare("INSERT INTO ra_learning_log (log_id, ts, action, exception_id, category, amount, detail) VALUES (?, now(), ?, ?, ?, ?, ?)")
    .bind(
      crypto.randomUUID(),
      `review_${body.decision}`,
      exceptionId,
      (current.exception as { category?: string } | null)?.category ?? null,
      amount,
      body.comment.trim(),
    )
    .run();
  return { review_id: reviewId, decision: body.decision, exception_id: exceptionId, action_id: body.decision === "reinvestigate" ? null : actionId };
}

export async function listDrafts(db: AppDb) {
  const { results } = await db.prepare("SELECT * FROM ra_outbound_drafts ORDER BY draft_id").all<Record<string, unknown>>();
  return { drafts: results ?? [], note: "Approval marks a draft ready for export. Nothing is sent to email or any external API." };
}

export async function decideDraft(db: AppDb, id: string, status: "approved" | "rejected", who: string) {
  await db.prepare("UPDATE ra_outbound_drafts SET status=?, approved_by=?, approved_at=now() WHERE draft_id=?").bind(status, who, id).run();
  return db.prepare("SELECT * FROM ra_outbound_drafts WHERE draft_id=?").bind(id).first();
}

export async function exportDraft(db: AppDb, id: string) {
  const row = await db.prepare("SELECT * FROM ra_outbound_drafts WHERE draft_id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const text = `# ${row.subject}\n\nStatus: ${row.status}\nParty: ${row.party}\nKind: ${row.kind}\n\n${row.body}\n`;
  return { filename: `${id}.txt`, text };
}

export async function listRisks(db: AppDb) {
  const { results: risks } = await db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM ra_risk_controls rc WHERE rc.risk_id=r.risk_id)::int AS controls,
              (SELECT COUNT(*) FROM ra_risk_controls rc JOIN ra_control_status s ON s.control_id=rc.control_id AND s.status='pass' WHERE rc.risk_id=r.risk_id)::int AS passing,
              (SELECT COUNT(*) FROM ra_risk_findings f WHERE f.risk_id=r.risk_id)::int AS findings
       FROM ra_risks r ORDER BY r.risk_id`,
    )
    .all<Record<string, unknown>>();
  const { results: map } = await db
    .prepare(
      `SELECT rc.risk_id, rc.control_id, c.name, s.status, s.leakage
       FROM ra_risk_controls rc
       JOIN ra_controls c ON c.control_id=rc.control_id
       LEFT JOIN ra_control_status s ON s.control_id=c.control_id
       ORDER BY rc.risk_id, c.name`,
    )
    .all<Record<string, unknown>>();
  const rows = (risks ?? []).map((r) => ({
    risk_id: r.risk_id,
    title: r.name ?? r.title ?? r.risk_id,
    category: r.domain ?? r.category ?? "",
    inherent: r.inherent,
    residual: r.residual,
    owner: r.owner ?? "—",
    controls: Number(r.controls ?? 0),
    findings: Number(r.findings ?? 0),
    passing: Number(r.passing ?? 0),
    exposure: (map ?? []).filter((m) => m.risk_id === r.risk_id).reduce((s, m) => s + Number(m.leakage ?? 0), 0),
  }));
  const gaps = rows.filter((r) => r.controls === 0 || r.passing === 0);
  return { risks: rows, map: map ?? [], gaps };
}

export async function getExplanation(env: Env, type: string, id: string, refresh = false) {
  const db = getDb(env);
  if (!refresh) {
    const cached = await db.prepare("SELECT * FROM ra_explanations WHERE subject_type=? AND subject_id=?").bind(type, id).first<Record<string, unknown>>();
    if (cached) return cached;
  }
  let context = "";
  if (type === "control") {
    const c = await db.prepare("SELECT * FROM ra_controls WHERE control_id=?").bind(id).first<Record<string, unknown>>();
    context = JSON.stringify(c ?? {});
  } else {
    const e = await db.prepare("SELECT * FROM ra_explanations WHERE subject_type='formula' AND subject_id=?").bind(id).first<Record<string, unknown>>();
    if (e && !refresh) return e;
    context = JSON.stringify(e ?? { subject: id });
  }
  let text = "";
  let source: "llm" | "deterministic" = "deterministic";
  try {
    text = await complete(
      env.AI,
      `Explain this revenue-assurance control, threshold or formula in plain language for a finance lead. 2-4 short sentences. Do not invent numbers. Synthetic book.\n${context}`,
    );
    source = "llm";
  } catch {
    text = "This control is evaluated from pre-aggregated Neon summaries. The threshold is applied in SQL; the model only explains the published definition.";
  }
  await db
    .prepare(
      `INSERT INTO ra_explanations (subject_type, subject_id, text, source, generated_at)
       VALUES (?, ?, ?, ?, now())
       ON CONFLICT (subject_type, subject_id) DO UPDATE SET text=EXCLUDED.text, source=EXCLUDED.source, generated_at=now()`,
    )
    .bind(type, id, text.trim(), source)
    .run();
  return db.prepare("SELECT * FROM ra_explanations WHERE subject_type=? AND subject_id=?").bind(type, id).first();
}

export async function simulateRule(db: AppDb, opts: { metric?: string; z?: number; control_id?: string; match_rate?: number }) {
  const z = opts.z ?? 2.5;
  const metric = opts.metric ?? "approval_rate";
  const { results } = await db
    .prepare(
      `SELECT COUNT(*)::int AS alerts,
              COALESCE(SUM(CASE
                WHEN metric='fee_ratio' THEN COALESCE(volume,0) * ABS(value-COALESCE(baseline,value)) / 10000
                ELSE COALESCE(volume,0) * ABS(value-COALESCE(baseline,value))
              END),0) AS amount
       FROM ra_metric_daily
       WHERE metric = ? AND stddev IS NOT NULL AND ABS(zscore) >= ?`,
    )
    .bind(metric, z)
    .all<{ alerts: number; amount: number }>();
  const baseline = await db
    .prepare(
      `SELECT COUNT(*)::int AS alerts,
              COALESCE(SUM(CASE
                WHEN metric='fee_ratio' THEN COALESCE(volume,0) * ABS(value-COALESCE(baseline,value)) / 10000
                ELSE COALESCE(volume,0) * ABS(value-COALESCE(baseline,value))
              END),0) AS amount
       FROM ra_metric_daily
       WHERE metric = ? AND is_anomaly = 1`,
    )
    .bind(metric)
    .first<{ alerts: number; amount: number }>();
  const simId = crypto.randomUUID();
  const row = results?.[0];
  await db
    .prepare(
      `INSERT INTO ra_rule_simulations (sim_id, subject, baseline_threshold, new_threshold, baseline_alerts, new_alerts, baseline_amount, new_amount, note)
       VALUES (?, ?, 'is_anomaly / |z|≥2.5', ?, ?, ?, ?, ?, 'Backtest on the synthetic October book. No rule was activated.')`,
    )
    .bind(simId, metric, `|z|≥${z}`, baseline?.alerts ?? 0, row?.alerts ?? 0, baseline?.amount ?? 0, row?.amount ?? 0)
    .run();
  return db.prepare("SELECT * FROM ra_rule_simulations WHERE sim_id=?").bind(simId).first();
}

export async function learningState(db: AppDb) {
  const policy = await db.prepare("SELECT * FROM ra_learning_policy WHERE id=1").first<Record<string, unknown>>();
  const { results: history } = await db
    .prepare(
      `SELECT COALESCE(split_part(exception_id, ':', 2), '') AS category, status, COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount
       FROM ra_action_queue
       WHERE status IN ('approved','rejected','done')
       GROUP BY 1, 2
       ORDER BY n DESC`,
    )
    .all<Record<string, unknown>>();
  const { results: log } = await db.prepare("SELECT * FROM ra_learning_log ORDER BY ts DESC LIMIT 20").all<Record<string, unknown>>();
  return { policy, history: history ?? [], log: log ?? [] };
}

export async function applyLearning(db: AppDb) {
  const policy = await db.prepare("SELECT * FROM ra_learning_policy WHERE id=1").first<{
    auto_close_enabled: number;
    max_amount: number;
    min_repeats: number;
    min_confidence: number;
  }>();
  if (!policy || !policy.auto_close_enabled) return { closed: 0, skipped: true };
  const { results: cats } = await db
    .prepare(
      `SELECT split_part(exception_id, ':', 2) AS category, COUNT(*)::int AS n
       FROM ra_action_queue WHERE status='approved'
       GROUP BY 1 HAVING COUNT(*) >= ?`,
    )
    .bind(policy.min_repeats)
    .all<{ category: string; n: number }>();
  let closed = 0;
  for (const c of cats ?? []) {
    const { results: rows } = await db
      .prepare(
        `SELECT action_id, exception_id, amount FROM ra_action_queue
         WHERE status='proposed' AND split_part(exception_id, ':', 2)=? AND amount <= ?`,
      )
      .bind(c.category, policy.max_amount)
      .all<{ action_id: string; exception_id: string; amount: number }>();
    for (const r of rows ?? []) {
      await db
        .prepare("UPDATE ra_action_queue SET status='done', decided_at=?, decision_note=? WHERE action_id=?")
        .bind(new Date().toISOString(), "Auto-closed by learning policy (repeat known variance).", r.action_id)
        .run();
      await db
        .prepare("INSERT INTO ra_learning_log (log_id, ts, action, exception_id, category, amount, detail) VALUES (?, now(), 'auto_close', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), r.exception_id, c.category, r.amount, `Repeat approved category (${c.n} prior). Amount under ₹${policy.max_amount}.`)
        .run();
      closed++;
    }
  }
  return { closed, policy };
}

export async function listFiles(db: AppDb) {
  const { results: summary } = await db
    .prepare(
      `SELECT e.file_kind, e.party, COUNT(*)::int AS expected, COUNT(r.received_id)::int AS received,
              COUNT(*) FILTER (WHERE r.received_id IS NULL)::int AS missing
       FROM ra_expected_files e
       LEFT JOIN ra_received_files r ON r.file_kind=e.file_kind AND r.party=e.party AND r.expected_date=e.expected_date
       GROUP BY 1,2 ORDER BY 1,2`,
    )
    .all<Record<string, unknown>>();
  const { results: exceptions } = await db
    .prepare("SELECT * FROM v_ra_files ORDER BY ts")
    .all<Record<string, unknown>>();
  return { summary: summary ?? [], exceptions: exceptions ?? [] };
}

export { validateAskSql } from "./askSql";
import { validateAskSql } from "./askSql";

const ASK_WRITE = /^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum)\b/i;

type AskCacheEntry = {
  at: number;
  payload: Record<string, unknown>;
};
const ASK_CACHE = new Map<string, AskCacheEntry>();
const ASK_CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(question: string): string {
  return normalizeQuestion(question);
}

async function logAsk(db: AppDb, question: string, sqlText: string, status: string, error?: string, rowCount?: number) {
  try {
    if (status === "ok") {
      await db
        .prepare("INSERT INTO ra_ask_log (log_id, ts, question, sql, status, row_count) VALUES (?, now(), ?, ?, 'ok', ?)")
        .bind(crypto.randomUUID(), question, sqlText, rowCount ?? 0)
        .run();
    } else {
      await db
        .prepare("INSERT INTO ra_ask_log (log_id, ts, question, sql, status, error) VALUES (?, now(), ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), question, sqlText, status, error ?? "")
        .run();
    }
  } catch {
    /* log table may be absent on a stale schema */
  }
}

async function llmSql(env: Env, question: string, repair?: { sql: string; error: string }): Promise<string> {
  const prompt = repair
    ? `The previous SQL failed. Write one corrected PostgreSQL SELECT. ${ASK_SCHEMA_PROMPT}\nQuestion: ${question}\nPrevious SQL:\n${repair.sql}\nError: ${repair.error}\nSQL:`
    : `You write one PostgreSQL SELECT for a synthetic revenue-assurance book. ${ASK_SCHEMA_PROMPT}\nQuestion: ${question}\nSQL:`;
  const raw = await complete(env.AI, prompt, { max_tokens: 256, timeout_ms: 12_000 });
  return raw.trim().replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/, "");
}

export async function askData(env: Env, question: string) {
  const db = getDb(env);
  const started = Date.now();
  const trimmedQ = question.trim();
  if (isOutOfScopeQuestion(trimmedQ)) {
    await logAsk(db, question, "", "refused", OUT_OF_SCOPE_MESSAGE);
    return {
      question,
      sql: "",
      status: "refused" as const,
      error: OUT_OF_SCOPE_MESSAGE,
      rows: [] as Record<string, unknown>[],
      answer: OUT_OF_SCOPE_MESSAGE,
      source: "scope",
      cached: false,
      timing_ms: Date.now() - started,
    };
  }
  const key = cacheKey(trimmedQ);
  const hit = ASK_CACHE.get(key);
  if (hit && Date.now() - hit.at < ASK_CACHE_TTL_MS) {
    return { ...hit.payload, question, cached: true, timing_ms: Date.now() - started };
  }

  // Reject only questions that ARE write/stacked SQL — not English that happens to contain "drop" or "update".
  if (ASK_WRITE.test(trimmedQ) || /;\s*\S/.test(trimmedQ)) {
    const err = "Only a single allow-listed SELECT is permitted. Write and multi-statement questions are rejected without execution.";
    await logAsk(db, question, "", "rejected", err);
    return { question, sql: "", status: "rejected" as const, error: err, rows: [] as Record<string, unknown>[], answer: err, source: "rejected", cached: false, timing_ms: Date.now() - started };
  }

  const template: AskTemplateHit | null = /^\s*(with|select)\b/i.test(trimmedQ) ? null : matchAskTemplate(trimmedQ);
  let generated = "";
  let source: "template" | "llm" | "sql" = "llm";
  if (/^\s*(with|select)\b/i.test(trimmedQ)) {
    generated = trimmedQ;
    source = "sql";
  } else if (template) {
    generated = template.sql;
    source = "template";
  } else {
    try {
      generated = await llmSql(env, trimmedQ);
      source = "llm";
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await logAsk(db, question, "", "error", err);
      return {
        question, sql: "", status: "error" as const, error: "The model could not write SQL in time. Retry, or pick a suggested question.",
        rows: [] as Record<string, unknown>[], answer: "", source: "llm", cached: false, timing_ms: Date.now() - started,
      };
    }
  }

  const tryRun = async (sqlCandidate: string) => {
    const sqlText = validateAskSql(sqlCandidate);
    const rows = await runReadOnly(env, sqlText);
    return { sqlText, rows };
  };

  let sqlText = generated;
  try {
    let ran: { sqlText: string; rows: Record<string, unknown>[] };
    try {
      ran = await tryRun(generated);
    } catch (first) {
      const firstErr = first instanceof Error ? first.message : String(first);
      if (source === "llm") {
        const repaired = await llmSql(env, trimmedQ, { sql: generated, error: firstErr });
        ran = await tryRun(repaired);
        generated = repaired;
      } else {
        throw first;
      }
    }
    sqlText = ran.sqlText;
    const answer = groundedAnswer(trimmedQ, ran.rows, template);
    await logAsk(db, question, sqlText, "ok", undefined, ran.rows.length);
    const payload = {
      question,
      sql: sqlText,
      status: "ok" as const,
      rows: ran.rows,
      answer,
      source,
      template_id: template?.id ?? null,
      cached: false,
      timing_ms: Date.now() - started,
    };
    ASK_CACHE.set(key, { at: Date.now(), payload });
    return payload;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const rejected = /allow-listed|not allowed|disallowed|single SELECT|Only SELECT/i.test(err);
    const status = rejected ? "rejected" : "error";
    const publicErr = rejected ? err : publicAskError(err);
    await logAsk(db, question, sqlText || generated, status, err.slice(0, 500));
    return {
      question, sql: sqlText || generated, status, error: publicErr, rows: [] as Record<string, unknown>[],
      answer: "", source, cached: false, timing_ms: Date.now() - started,
    };
  }
}

function publicAskError(err: string) {
  if (/timeout|cancel/i.test(err)) return "The query timed out. Try a narrower question.";
  if (/permission|readonly|ra_readonly/i.test(err)) return "The query was blocked by the read-only role.";
  return "The query could not be run. Check the generated SQL against the allow-listed views.";
}

async function runReadOnly(env: Env, sqlText: string): Promise<Record<string, unknown>[]> {
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(env.DATABASE_URL);
  // Single-statement path: prepend SET via a DO wrapper is unsafe. Use transaction if available.
  const tx = (client as unknown as { transaction?: (fn: (sql: { query: (q: string, p?: unknown[]) => Promise<unknown> }) => Promise<unknown>[]) => Promise<unknown> }).transaction;
  if (typeof tx === "function") {
    const out = (await tx((sql) => [
      sql.query("SET LOCAL statement_timeout = 3000"),
      sql.query("SET TRANSACTION READ ONLY"),
      sql.query("SET LOCAL ROLE ra_readonly"),
      sql.query(sqlText),
    ])) as unknown[];
    const last = out[out.length - 1];
    return Array.isArray(last) ? (last as Record<string, unknown>[]) : [];
  }
  await client.query("SET statement_timeout = 3000");
  const rows = (await client.query(sqlText)) as Record<string, unknown>[];
  return rows ?? [];
}

export async function graphTools(db: AppDb, opts: { merchant_id?: string; exception_id?: string }) {
  const merchant = opts.merchant_id;
  const paths = merchant
    ? (
        await db
          .prepare(
            `SELECT m.merchant_id, m.name, ma.acquirer_id, a.name AS acquirer, a.sponsor_bank,
                    ? AS hop_note
             FROM ra_merchants m
             LEFT JOIN ra_merchant_acquirers ma ON ma.merchant_id=m.merchant_id
             LEFT JOIN ra_acquirers a ON a.acquirer_id=ma.acquirer_id
             WHERE m.merchant_id=?`,
          )
          .bind("merchant→acquirer→sponsor bank→scheme/issuer", merchant)
          .all<Record<string, unknown>>()
      ).results
    : [];
  const { results: rings } = await db
    .prepare(
      `SELECT e.rel, e.src, e.dst, e.weight
       FROM ra_risk_edges e
       WHERE e.rel IN ('refund','chargeback','shared_device','shared_account','round_trip')
          OR e.src LIKE ? OR e.dst LIKE ?
       ORDER BY e.weight DESC NULLS LAST
       LIMIT 12`,
    )
    .bind(merchant ? `%${merchant}%` : "%", merchant ? `%${merchant}%` : "%")
    .all<Record<string, unknown>>();
  let proximity: unknown[] = [];
  try {
    const g = await networkRisk(db);
    proximity = (g.proximity ?? []).slice(0, 8);
  } catch {
    proximity = [];
  }
  return {
    path: paths ?? [],
    rings: rings ?? [],
    proximity,
    note: "Merchant-to-acquirer path, refund or chargeback rings, and closeness to known-bad entities. These links come from the ledger; they are not invented.",
  };
}
