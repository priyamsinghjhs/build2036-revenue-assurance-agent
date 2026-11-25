import type { Hono } from "hono";
import { handleWhy } from "./why";
import { handleGlossary } from "./glossary";
import { handleBulkAction } from "./bulk";
import { runRetention } from "./retention";
import { csrfToken, csrfMiddleware } from "./csrf";
import { requireUser } from "./auth";
import { listRules, upsertRule } from "./rules";
import { handleIngestFile } from "./parsers";

export function registerExtraRoutes(app: Hono) {
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

  app.get("/api/sla", async (c) => {
    requireUser(c);
    const db = (await import("./pg")).getDb(c.env);
    const { results } = await db.prepare("SELECT * FROM v_ra_sla_ageing LIMIT 100").all().catch(() => ({ results: [] }));
    return c.json({ ageing: results ?? [] });
  });
}
