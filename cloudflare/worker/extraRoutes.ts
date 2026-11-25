import type { Hono } from "hono";
import { handleWhy } from "./why";
import { handleGlossary } from "./glossary";
import { handleBulkAction } from "./bulk";
import { runRetention } from "./retention";
import { csrfToken } from "./csrf";
import { requireUser } from "./auth";

export function registerExtraRoutes(app: Hono) {
  app.get("/api/glossary", (c) => handleGlossary(c));
  app.get("/api/exceptions/:id/why", (c) => handleWhy(c));
  app.post("/api/actions/bulk", (c) => handleBulkAction(c));
  app.post("/api/admin/retention", async (c) => {
    requireUser(c);
    return c.json(await runRetention(c.env));
  });
  app.get("/api/csrf", (c) => {
    const token = csrfToken();
    c.header("Set-Cookie", `csrf-token=${token}; Path=/; SameSite=Strict; HttpOnly`);
    return c.json({ token });
  });
}
