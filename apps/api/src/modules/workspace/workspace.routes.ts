import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { authOf, requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as ws from "./workspace.service.js";

const id = z.object({ id: z.string().uuid() });
const daysQuery = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d)).default(30) });
const agendaQuery = z.object({ mine: z.enum(["true", "false"]).default("false") });
const auditQuery = z.object({ action: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });
const stageSchema = z.object({ name: z.string().trim().min(2).max(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
const fieldSchema = z.object({ label: z.string().trim().min(2).max(80), type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]), options: z.array(z.string().trim().min(1).max(60)).max(30).default([]) });
const valuesSchema = z.object({ values: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])) });

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

workspaceRouter.get("/agenda", validate(agendaQuery, "query"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.json(await ws.getAgenda(organizationId, userId, (req.query as { mine: string }).mine === "true"));
});

workspaceRouter.get("/notifications", async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.json(await ws.listNotifications(organizationId, userId));
});

workspaceRouter.post("/notifications/read", async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await ws.markNotificationsRead(organizationId, userId, typeof req.body?.id === "string" ? req.body.id : undefined);
  res.status(204).end();
});

workspaceRouter.get("/reports", validate(daysQuery, "query"), async (req, res) => {
  res.json(await ws.getReport(authOf(req).organizationId, (req.query as unknown as { days: number }).days));
});

workspaceRouter.get("/reports/leads.csv", async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await audit({ action: "lead.export", organizationId, userId, req });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(await ws.exportLeadsCsv(organizationId));
});

workspaceRouter.get("/search", validate(searchQuery, "query"), async (req, res) => {
  res.json(await ws.globalSearch(authOf(req).organizationId, (req.query as { q: string }).q));
});

// ── Administração (dono/admin) ──
workspaceRouter.patch("/stages/:id", requireRole("OWNER", "ADMIN"), validate(id, "params"), validate(stageSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await ws.updateStage(organizationId, req.params.id as string, req.body);
  await audit({ action: "settings.stage_updated", organizationId, userId, entityId: req.params.id as string, req });
  res.status(204).end();
});

workspaceRouter.delete("/tags/:id", requireRole("OWNER", "ADMIN"), validate(id, "params"), async (req, res) => {
  await ws.deleteTag(authOf(req).organizationId, req.params.id as string);
  res.status(204).end();
});

workspaceRouter.get("/custom-fields", async (req, res) => res.json(await ws.listCustomFields(authOf(req).organizationId)));

workspaceRouter.post("/custom-fields", requireRole("OWNER", "ADMIN"), validate(fieldSchema), async (req, res) => {
  res.status(201).json(await ws.createCustomField(authOf(req).organizationId, req.body));
});

workspaceRouter.delete("/custom-fields/:id", requireRole("OWNER", "ADMIN"), validate(id, "params"), async (req, res) => {
  await ws.deleteCustomField(authOf(req).organizationId, req.params.id as string);
  res.status(204).end();
});

workspaceRouter.put("/leads/:id/custom-fields", validate(id, "params"), validate(valuesSchema), async (req, res) => {
  res.json(await ws.setLeadCustomFields(authOf(req).organizationId, req.params.id as string, req.body.values));
});

workspaceRouter.get("/audit", requireRole("OWNER", "ADMIN"), validate(auditQuery, "query"), async (req, res) => {
  res.json(await ws.listAudit(authOf(req).organizationId, req.query as unknown as { action?: string; limit: number }));
});
