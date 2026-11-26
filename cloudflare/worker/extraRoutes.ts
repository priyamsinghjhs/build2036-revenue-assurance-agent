import type { Hono } from "hono";
import type { AppUser } from "../shared/roles";
import type { Env } from "./types";
import { handleWhy } from "./why";
import { handleGlossary } from "./glossary";
import { handleBulkAction } from "./bulk";
import { runRetention } from "./retention";
import { csrfToken, csrfMiddleware } from "./csrf";
import { requireUser } from "./auth";
import { listRules, upsertRule } from "./rules";
import { handleIngestFile } from "./parsers";
import { decideRules, getRuleHistory, getRules, proposeRules } from "./reconConfig";
import { recoveryItem, recoveryList, recoverySummary, recoveryTransition } from "./recovery";
import { createReconJob, getReconJob, listReconJobs } from "./reconJobs";
import { reconcileRange } from "./incrementalRecon";

type App = Hono<{ Bindings: Env; Variables: { user?: AppUser } }>;

export function registerExtraRoutes(app: App) {
  // CSRF token (call once after login)
  app.get("/api/csrf", (c) => {
    const token = csrfToken();
    c.header("Set-Cookie", `csrf-token=${token}; Path=/; SameSite=Strict; Secure; HttpOnly`);
    return c.json({ token });
  });

  // Apply CSRF to mutating extra routes
  app.use("/api/actions/bulk", csrfMiddleware);
  app.use("/api/admin/*", csrfMiddleware);
  app.use("/api/rules", csrfMiddleware);
  app.use("/api/ingest/file", csrfMiddleware);
  app.use("/api/recon/*", csrfMiddleware);
  app.use("/api/recovery/*", csrfMiddleware);

  // Configurable recon rules (versioned, maker-checker, audited).
  app.get("/api/recon/rules", (c) => getRules(c));
  app.get("/api/recon/rules/history", (c) => getRuleHistory(c));
  app.post("/api/recon/rules/proposals", (c) => proposeRules(c));
  app.post("/api/recon/rules/proposals/:version/decision", (c) => decideRules(c));

  // Background recon jobs (202 + polling; DB job table, ctx.waitUntil, cron sweep).
  app.post("/api/recon/jobs", (c) => createReconJob(c));
  app.get("/api/recon/jobs", (c) => listReconJobs(c));
  app.get("/api/recon/jobs/:id", (c) => getReconJob(c));

  // Recovery tracking to closure.
  app.get("/api/recovery", (c) => recoveryList(c));
  app.get("/api/recovery/summary", (c) => recoverySummary(c));
  app.get("/api/recovery/items/:id", (c) => recoveryItem(c));
  app.post("/api/recovery/items/:id/transition", (c) => recoveryTransition(c));

  app.get("/api/glossary", (c) => handleGlossary(c));
  app.get("/api/exceptions/:id/why", (c) => handleWhy(c));
  app.post("/api/actions/bulk", (c) => handleBulkAction(c));

  app.post("/api/admin/retention", async (c) => {
    requireUser(c);
    return c.json(await runRetention(c.env));
  });

  app.get("/api/rules", (c) => listRules(c));
  app.post("/api/rules", (c) => upsertRule(c));

  app.post("/api/ingest/file", (c) => handleIngestFile(c));

  app.post("/api/recon/incremental", async (c) => {
    requireUser(c);
    const body = await c.req.json().catch(() => ({}));
    const result = await reconcileRange(c.env, {
      area: body.area || "all",
      from: body.from,
      to: body.to,
      force: body.force === true,
    });
    return c.json(result);
  });

  app.get("/api/sla", async (c) => {
    requireUser(c);
    const db = (await import("./pg")).getDb(c.env);
    const { results } = await db.prepare("SELECT * FROM v_ra_sla_ageing LIMIT 100").all().catch(() => ({ results: [] }));
    return c.json({ ageing: results ?? [] });
  });
}
