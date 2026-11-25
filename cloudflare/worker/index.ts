import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AGENT_GRAPH_EDGES, AGENT_ROSTER, RUN_ALL_SEQUENCE, sequenceForDomain, type AgentId } from "./agentRoster";
import { completeRun, latestRun, listActions, runAgentStep, startRun } from "./agentRunner";
import {
  NotFoundError,
  runAnomalyDetector,
  runAuditor,
  runEvidenceSynthesizer,
  runInvestigator,
  runRecommendationAgent,
} from "./agents";
import { listSettlements } from "./db";
import {
  AREA_IDS,
  AREA_META,
  areaSeries,
  getException,
  kpiCounts,
  leakageByCategory,
  leakageTrend,
  listExceptions,
  moneyFlow,
  summarizeAll,
  summarizeArea,
  systemMap,
  type AreaId,
} from "./recon";
import type { AgentState, Env } from "./types";
import { getDb } from "./pg";
import { cachedJson, invalidateMem } from "./cache";
import { executiveSummary, listFilterOptions } from "./executive";
import { latestAutomation, runDailyAutomation, setActionStatus } from "./automation";
import { traceJourney } from "./trace";
import { networkExportCsv, networkRisk } from "./network";
import {
  applyLearning, askData, decideDraft, decideRule, exportDraft, extractContractRules,
  getCase, getDocument, getExplanation, getReview, graphTools, intelOverview,
  investigateAnomaly, learningState, listAnomalies, listCases, listDocuments,
  listDrafts, listFiles, listReviews, listRisks, retrieveChunks, routingSummary,
  runRoutingSim, simulateRule, submitReview, updateCase, testRule, ruleTests, evalQuality,
} from "./intel";
import { listIngestion, persistIngestion } from "./ingest";
import { getModel, modelDetail, modelsOverview, predictFeatures } from "./ml/registry";
import { ASK_VIEWS, SUGGESTED_QUESTIONS } from "./askTemplates";
import { prefetchEvidence, runInvestigation, sseResponse } from "./investigateFlow";
import { openDataOverview } from "./openData";
import { overview as dataSourcesOverview, upsertConnection, deleteConnection, testConnection, syncConnection } from "./dataSources/store";
import { decideAuditorSuggestion, listSuggestionDecisions, type AuditSuggestion } from "./auditor";
import { AppError, publicErrorMessage } from "../shared/errors";
import type { AppUser } from "../shared/roles";
import {
  authMiddleware,
  assertCanApprove,
  handleLogin,
  handleLogout,
  handleMe,
  handleUsers,
  recordAudit,
  requireUser,
} from "./auth";
import { areaFromExceptionId, areaInRoleScope } from "../shared/scope";
import {
  assertAreaVisible,
  assertRecordVisible,
  filterRowsByScope,
  loadAssignedIds,
} from "./scopeAccess";

import { withSecurityHeaders } from "./securityHeaders";
import { registerExtraRoutes } from "./extraRoutes";

const app = new Hono<{ Bindings: Env; Variables: { user?: AppUser } }>();

app.use("/api/*", authMiddleware);
registerExtraRoutes(app);

app.post("/api/auth/login", (c) => handleLogin(c));
app.post("/api/auth/logout", (c) => handleLogout(c));
app.get("/api/auth/me", (c) => handleMe(c));
app.get("/api/auth/users", (c) => handleUsers(c));

app.get("/api/health", (c) => c.json({ ok: true, synthetic: true }));

app.get("/api/filters", async (c) => c.json(await listFilterOptions(getDb(c.env))));

app.get("/api/executive", async (c) => {
  return cachedJson(
    "executive",
    async () => executiveSummary(getDb(c.env)),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.post("/api/automation/run", async (c) => {
  const result = await runDailyAutomation(c.env, { force: true });
  invalidateMem();
  return c.json(result, result.ok ? 200 : 500);
});

app.get("/api/automation/latest", async (c) => {
  try {
    const latest = await latestAutomation(getDb(c.env));
    return c.json({ latest });
  } catch {
    return c.json({ latest: null });
  }
});

app.post("/api/actions/:id/decision", async (c) => {
  const body = await readJson(c);
  const status = requiredString(body, "status");
  if (!["approved", "rejected", "done"].includes(status)) {
    throw new HTTPException(400, { message: "status must be approved, rejected, or done" });
  }
  const user = requireUser(c);
  const db = getDb(c.env);
  const action = await db
    .prepare("SELECT action_id, action, amount, exception_id FROM ra_action_queue WHERE action_id = ?")
    .bind(c.req.param("id"))
    .first<{ action_id: string; action: string; amount: number; exception_id: string | null }>();
  if (!action) throw new HTTPException(404, { message: "Action not found" });
  await assertRecordVisible(db, user, {
    type: "action",
    id: action.action_id,
    area: areaFromExceptionId(action.exception_id),
  });
  if (status === "approved") {
    assertCanApprove(user.role, { action: action.action, exceptionId: action.exception_id, amount: Number(action.amount) });
  }
  const ok = await setActionStatus(
    db,
    c.req.param("id"),
    status as "approved" | "rejected" | "done",
    optionalString(body, "note") || undefined,
    user.id,
  );
  if (!ok) throw new HTTPException(404, { message: "Action not found" });
  await recordAudit(c.env, user, "POST", c.req.path, status, c.req.param("id"), { action: action.action, amount: action.amount });
  invalidateMem();
  return c.json({ ok: true, action_id: c.req.param("id"), status, decided_by: user.id });
});

app.get("/api/dashboard/overview", async (c) => {
  return cachedJson(
    "overview",
    async () => {
      const db = getDb(c.env);
      const [kpis, areas, byCategory, trend, flow] = await Promise.all([
        kpiCounts(db),
        summarizeAll(db),
        leakageByCategory(db),
        leakageTrend(db),
        moneyFlow(db),
      ]);
      return {
        synthetic: true,
        kpis: {
          total_leakage: kpis.total_leakage,
          recovery_potential: kpis.recovery_potential,
          match_rate: kpis.match_rate,
          exception_count: kpis.exception_count,
          auth_count: kpis.auth_count,
          merchant_count: kpis.merchant_count,
        },
        areas,
        by_category: byCategory,
        trend,
        flow,
      };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/system-map", async (c) => {
  return cachedJson(
    "system-map",
    async () => ({ synthetic: true, ...(await systemMap(getDb(c.env))) }),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/areas", (c) => {
  const user = requireUser(c);
  return c.json({
    areas: AREA_IDS.filter((id) => areaInRoleScope(user.role, id)).map((id) => ({ id, ...AREA_META[id] })),
  });
});

app.get("/api/areas/:id", async (c) => {
  const id = c.req.param("id") as AreaId;
  if (!AREA_IDS.includes(id)) throw new HTTPException(404, { message: "Unknown area" });
  await assertAreaVisible(requireUser(c), id);
  return cachedJson(
    `area:${id}`,
    async () => {
      const db = getDb(c.env);
      const [summary, exceptions, series] = await Promise.all([
        summarizeArea(db, id),
        listExceptions(db, id, 100),
        areaSeries(db, id),
      ]);
      return { synthetic: true, meta: AREA_META[id], summary, series, exceptions };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/exceptions/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const row = await getException(getDb(c.env), id);
  if (!row) throw new NotFoundError("Exception not found");
  await assertRecordVisible(getDb(c.env), user, { type: "exception", id, area: (row as { area?: string }).area });
  return c.json({ exception: row });
});

app.get("/api/agents/roster", (c) =>
  c.json({ agents: AGENT_ROSTER, edges: AGENT_GRAPH_EDGES, run_all: RUN_ALL_SEQUENCE }),
);

app.get("/api/agents/latest", async (c) => {
  const scope = c.req.query("scope") ?? undefined;
  const latest = await latestRun(getDb(c.env), scope);
  return c.json({ latest });
});

app.get("/api/actions", async (c) => {
  const user = requireUser(c);
  const db = getDb(c.env);
  const actions = await listActions(db);
  const assigned = await loadAssignedIds(db, user.id, ["exception", "action"]);
  return c.json({
    actions: filterRowsByScope(
      user,
      actions,
      (r) => areaFromExceptionId(String((r as { exception_id?: string }).exception_id || "")),
      assigned,
      (r) => String((r as { exception_id?: string; action_id?: string }).exception_id || (r as { action_id?: string }).action_id || ""),
    ),
  });
});

app.post("/api/agents/runs", async (c) => {
  const body = await readJson(c);
  const scope = optionalString(body, "scope") || "all";
  const run = await startRun(getDb(c.env), scope);
  const domain = optionalString(body, "domain");
  const sequence = scope === "all" ? RUN_ALL_SEQUENCE : sequenceForDomain(domain || scope);
  return c.json({ ...run, sequence });
});

app.post("/api/agents/step", async (c) => {
  const body = await readJson(c);
  const runId = requiredString(body, "run_id");
  const agentId = requiredString(body, "agent_id") as AgentId;
  if (!AGENT_ROSTER.some((a) => a.id === agentId)) {
    throw new HTTPException(400, { message: "Unknown agent_id" });
  }
  const mode = optionalString(body, "mode") === "deterministic" ? "deterministic" as const : undefined;
  const result = await runAgentStep(c.env, {
    runId,
    agentId,
    scope: optionalString(body, "scope") || "all",
    domain: optionalString(body, "domain") || undefined,
    exceptionId: optionalString(body, "exception_id") || undefined,
    mode,
  });
  return c.json(result);
});

app.post("/api/agents/complete", async (c) => {
  const body = await readJson(c);
  const runId = requiredString(body, "run_id");
  await completeRun(getDb(c.env), runId);
  return c.json({ ok: true, run_id: runId, status: "completed" });
});

app.get("/api/agents/evidence", async (c) => {
  const exceptionId = c.req.query("exception_id") || "";
  if (!exceptionId) return c.json({ error: "exception_id is required" }, 400);
  await assertRecordVisible(getDb(c.env), requireUser(c), { type: "exception", id: exceptionId, area: areaFromExceptionId(exceptionId) });
  return c.json(await prefetchEvidence(c.env, exceptionId));
});

app.post("/api/agents/investigate", async (c) => {
  const body = await readJson(c);
  const exceptionId = requiredString(body, "exception_id");
  await assertRecordVisible(getDb(c.env), requireUser(c), { type: "exception", id: exceptionId, area: areaFromExceptionId(exceptionId) });
  const domain = optionalString(body, "domain") || undefined;
  const runId = optionalString(body, "run_id") || undefined;
  const mode = optionalString(body, "mode") === "deterministic" ? "deterministic" as const : undefined;
  const accept = c.req.header("accept") || "";
  if (accept.includes("text/event-stream")) {
    return sseResponse(async (send) => {
      await runInvestigation(c.env, {
        exceptionId,
        domain,
        runId,
        mode,
        onEvent: (ev) => send(ev.type, ev),
      });
    });
  }
  const result = await runInvestigation(c.env, { exceptionId, domain, runId, mode });
  return c.json(result);
});

app.get("/api/open-data", async (c) => c.json(await openDataOverview(getDb(c.env))));

app.get("/api/settings/data-sources", async (c) => c.json(await dataSourcesOverview(getDb(c.env), c.env)));
app.post("/api/settings/data-sources", async (c) => {
  const body = await readJson(c);
  const result = await upsertConnection(getDb(c.env), c.env, body);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 503);
  return c.json(result);
});
app.put("/api/settings/data-sources/:id", async (c) => {
  const body = await readJson(c);
  body.connection_id = c.req.param("id");
  const result = await upsertConnection(getDb(c.env), c.env, body);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 503);
  return c.json(result);
});
app.delete("/api/settings/data-sources/:id", async (c) => {
  const ok = await deleteConnection(getDb(c.env), c.req.param("id"));
  return c.json({ ok }, (ok ? 200 : 404) as 200 | 404);
});
app.post("/api/settings/data-sources/:id/test", async (c) => {
  const result = await testConnection(getDb(c.env), c.env, c.req.param("id"));
  return c.json(result.body, result.status as 200 | 400 | 404 | 500 | 503);
});
app.post("/api/settings/data-sources/:id/sync", async (c) => {
  const result = await syncConnection(getDb(c.env), c.env, c.req.param("id"));
  return c.json(result.body, result.status as 200 | 400 | 404 | 500 | 503);
});

// Legacy settlement + 5-agent endpoints (still used if a settlement is investigated)
app.get("/api/settlements", async (c) => {
  try {
    const settlements = await listSettlements(getDb(c.env));
    return c.json({ settlements });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Could not load settlements: ${message}` }, 500);
  }
});

app.post("/api/legacy/agents/anomaly", async (c) => {
  const body = await readJson(c);
  return c.json(await runAnomalyDetector(c.env, requiredString(body, "settlement_id")));
});
app.post("/api/legacy/agents/investigate", async (c) => {
  const body = await readJson(c);
  const _legacyEx = String(body.exception_id || body.id || body.settlement_id || "");
  if (_legacyEx) await assertRecordVisible(getDb(c.env), requireUser(c), { type: "exception", id: String(_legacyEx), area: areaFromExceptionId(String(_legacyEx)) });
  return c.json(
    await runInvestigator(c.env, {
      settlement_id: requiredString(body, "settlement_id"),
      anomaly_result: optionalString(body, "anomaly_result"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/evidence", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runEvidenceSynthesizer(c.env, {
      investigation: optionalString(body, "investigation"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/recommend", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runRecommendationAgent(c.env, {
      evidence: optionalString(body, "evidence"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/audit", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runAuditor(c.env, {
      evidence: optionalString(body, "evidence"),
      recommendation: optionalString(body, "recommendation"),
      audit_trail: optionalTrail(body),
    }),
  );
});

app.get("/api/controls", async (c) => {
  return cachedJson(
    "controls",
    async () => {
      const db = getDb(c.env);
      const { results: rows } = await db
        .prepare(
          `SELECT c.control_id, c.name, c.objective, c.domain, c.owner, c.frequency, c.threshold,
                  s.last_run, s.status, s.exception_count, s.leakage, s.trend, s.coverage
           FROM ra_controls c
           LEFT JOIN ra_control_status s ON s.control_id = c.control_id
           ORDER BY CASE WHEN s.status = 'fail' THEN 0 ELSE 1 END, s.leakage DESC NULLS LAST, c.domain, c.name`,
        )
        .all<Record<string, unknown>>();
      const { results: byDomain } = await db
        .prepare(
          `SELECT c.domain,
                  COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE s.status = 'pass')::int AS passing,
                  COUNT(*) FILTER (WHERE s.status = 'fail')::int AS failing,
                  COALESCE(SUM(s.leakage),0) AS leakage
           FROM ra_controls c
           LEFT JOIN ra_control_status s ON s.control_id = c.control_id
           GROUP BY c.domain
           ORDER BY c.domain`,
        )
        .all<Record<string, unknown>>();
      const gov = await db.prepare("SELECT * FROM ra_governance_kpi WHERE id = 1").first<Record<string, unknown>>();
      return { synthetic: true, controls: rows ?? [], by_domain: byDomain ?? [], kpis: gov };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/trace", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ query: "", resolved: null, steps: [] });
  return c.json(await traceJourney(getDb(c.env), q));
});

app.get("/api/network-risk", async (c) => {
  return cachedJson(
    "network-risk",
    async () => networkRisk(getDb(c.env)),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/network-risk/export", async (c) => {
  const kind = c.req.query("kind") === "edges" ? "edges" : "nodes";
  const csv = await networkExportCsv(getDb(c.env), kind);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="network-risk-${kind}.csv"`,
    },
  });
});

app.get("/api/intel", async (c) => c.json(await intelOverview(getDb(c.env))));
app.get("/api/eval/quality", async (c) => c.json(await evalQuality(getDb(c.env))));
app.get("/api/contracts", async (c) => {
  const user = requireUser(c);
  if (!areaInRoleScope(user.role, "contracts")) return c.json({ documents: [] });
  return c.json(await listDocuments(getDb(c.env)));
});
app.get("/api/contracts/documents/:id", async (c) => {
  await assertAreaVisible(requireUser(c), "contracts");
  const doc = await getDocument(getDb(c.env), c.req.param("id"));
  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json(doc);
});
app.post("/api/contracts/extract", async (c) => {
  await assertAreaVisible(requireUser(c), "contracts");
  const body = await readJson(c);
  const id = String(body.doc_id || body.document_id || "");
  if (!id) return c.json({ error: "doc_id is required" }, 400);
  return c.json(await extractContractRules(c.env, id));
});
app.post("/api/contracts/rules/:id/decision", async (c) => {
  await assertAreaVisible(requireUser(c), "contracts");
  const body = await readJson(c);
  const status = body.status === "rejected" ? "rejected" : "approved";
  const user = requireUser(c);
  return c.json({ rule: await decideRule(getDb(c.env), c.req.param("id"), status, user.id) });
});
app.get("/api/contracts/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ chunks: [] });
  return c.json(await retrieveChunks(c.env, q));
});
app.get("/api/anomalies", async (c) => {
  const user = requireUser(c);
  if (!areaInRoleScope(user.role, "anomalies")) return c.json({ events: [] });
  return c.json(await listAnomalies(getDb(c.env)));
});
app.post("/api/anomalies/investigate", async (c) => {
  const body = await readJson(c);
  return c.json(await investigateAnomaly(c.env, requiredString(body, "event_id")));
});
app.get("/api/routing", async (c) => c.json(await routingSummary(getDb(c.env))));
app.post("/api/routing/sim", async (c) => c.json(await runRoutingSim(c.env)));
app.get("/api/ask/templates", (c) => c.json({ views: ASK_VIEWS, suggested: SUGGESTED_QUESTIONS }));
app.post("/api/ask", async (c) => {
  const body = await readJson(c);
  return c.json(await askData(c.env, requiredString(body, "question")));
});
app.get("/api/models", async (c) => c.json(await modelsOverview(getDb(c.env))));
app.get("/api/models/:id", async (c) => {
  const m = await modelDetail(getDb(c.env), c.req.param("id"));
  if (!m) return c.json({ error: "Model not found" }, 404);
  return c.json(m);
});
app.post("/api/models/:id/predict", async (c) => {
  const body = await readJson(c);
  return c.json(await predictFeatures(c.env, c.req.param("id"), body));
});
app.get("/api/cases", async (c) => c.json(await listCases(getDb(c.env))));
app.get("/api/cases/:id", async (c) => {
  const row = await getCase(getDb(c.env), c.req.param("id"));
  if (!row) return c.json({ error: "Case not found" }, 404);
  return c.json(row);
});
app.post("/api/cases/:id", async (c) => {
  const body = await readJson(c);
  return c.json(await updateCase(getDb(c.env), c.req.param("id"), body, requireUser(c).id));
});
app.get("/api/risks", async (c) => c.json(await listRisks(getDb(c.env))));
app.get("/api/files", async (c) => c.json(await listFiles(getDb(c.env))));
app.get("/api/reviews", async (c) => c.json(await listReviews(getDb(c.env))));
app.get("/api/reviews/:id", async (c) => {
  const row = await getReview(getDb(c.env), c.req.param("id"));
  if (!row) return c.json({ error: "Review not found" }, 404);
  return c.json(row);
});
app.post("/api/reviews/:id", async (c) => {
  const body = await readJson(c);
  return c.json(await submitReview(getDb(c.env), c.req.param("id"), body, requireUser(c).id));
});
app.get("/api/drafts", async (c) => c.json(await listDrafts(getDb(c.env))));
app.post("/api/drafts/:id/decision", async (c) => {
  const body = await readJson(c);
  return c.json(await decideDraft(getDb(c.env), c.req.param("id"), body, requireUser(c).id));
});
app.get("/api/drafts/:id/export", async (c) => {
  const csv = await exportDraft(getDb(c.env), c.req.param("id"));
  return new Response(csv, { headers: { "content-type": "text/csv" } });
});
app.get("/api/learning", async (c) => c.json(await learningState(getDb(c.env))));
app.post("/api/learning/apply", async (c) => c.json(await applyLearning(getDb(c.env))));
app.get("/api/graph-tools", async (c) => {
  const q = c.req.query("q") || "";
  return c.json(await graphTools(getDb(c.env), { q }));
});
app.get("/api/explanations/:id", async (c) => {
  const row = await getExplanation(getDb(c.env), c.req.param("id"));
  if (!row) return c.json({ error: "Explanation not found" }, 404);
  return c.json(row);
});
app.get("/api/rule-tests", async (c) => c.json(await ruleTests(getDb(c.env))));
app.post("/api/contracts/rules/:id/test", async (c) => {
  await assertAreaVisible(requireUser(c), "contracts");
  return c.json(await testRule(c.env, c.req.param("id")));
});
app.get("/api/ingestion", async (c) => c.json(await listIngestion(getDb(c.env))));
app.post("/api/ingestion/parse", async (c) => {
  try {
    return c.json(await persistIngestion(getDb(c.env)));
  } catch (err) {
    throw new AppError(publicErrorMessage(err, "The sample files could not be parsed."), 400);
  }
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const message = publicErrorMessage(err, err.message);
    return c.json({ error: message }, err.status as 400 | 401 | 403 | 404 | 429 | 500);
  }
  if (err instanceof AppError) return c.json({ error: publicErrorMessage(err, err.message) }, err.status as 400 | 401 | 403 | 404 | 429 | 500);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/not found/i.test(msg)) return c.json({ error: publicErrorMessage(err, msg) }, 404);
  if (/is required|must be |invalid /i.test(msg)) return c.json({ error: publicErrorMessage(err, msg) }, 400);
  return c.json({ error: publicErrorMessage(err) }, 500);
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HTTPException(400, { message: "JSON object body required" });
    }
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HTTPException(400, { message: `${key} is required` });
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function optionalTrail(body: Record<string, unknown>): string[] {
  const value = body.audit_trail;
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

export type { AgentState, Env };
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const work = runDailyAutomation(env, { force: false }).then(() => invalidateMem());
  ctx.waitUntil(work);
  await work;
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const res = url.pathname.startsWith("/api/")
    ? await app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2])
    : await env.ASSETS.fetch(request);
  return withSecurityHeaders(res, url.pathname);
}

export default {
  fetch: handleFetch,
  scheduled,
};
