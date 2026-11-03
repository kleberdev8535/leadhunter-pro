import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { authOf, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as crm from "./crm.service.js";
import {
  createLeadSchema,
  importResultsSchema,
  listLeadsQuery,
  listTasksQuery,
  logActivitySchema,
  moveLeadSchema,
  noteSchema,
  tagSchema,
  taskSchema,
  updateLeadSchema,
  updateTaskSchema,
} from "./crm.schemas.js";

const id = z.object({ id: z.string().uuid() });
const noteParams = z.object({ id: z.string().uuid(), noteId: z.string().uuid() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(50) });

export const crmRouter = Router();
crmRouter.use(requireAuth);

crmRouter.get("/pipeline", async (req, res) => res.json(await crm.getPipeline(authOf(req).organizationId)));
crmRouter.get("/filters", async (req, res) => res.json(await crm.getFilterOptions(authOf(req).organizationId)));

crmRouter.get("/leads", validate(listLeadsQuery, "query"), async (req, res) => {
  res.json(await crm.listLeads(authOf(req).organizationId, req.query as unknown as z.infer<typeof listLeadsQuery>));
});

crmRouter.post("/leads", validate(createLeadSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const lead = await crm.createLead(organizationId, userId, req.body);
  await audit({ action: "lead.create", organizationId, userId, entity: "Lead", entityId: lead.id, req });
  res.status(201).json(lead);
});

crmRouter.get("/leads/:id", validate(id, "params"), async (req, res) => {
  res.json(await crm.getLead(authOf(req).organizationId, req.params.id as string));
});

crmRouter.patch("/leads/:id", validate(id, "params"), validate(updateLeadSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.json(await crm.updateLead(organizationId, userId, req.params.id as string, req.body));
});

crmRouter.post("/leads/:id/move", validate(id, "params"), validate(moveLeadSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.json(await crm.moveLead(organizationId, userId, req.params.id as string, req.body.stageId, req.body.index));
});

crmRouter.delete("/leads/:id", validate(id, "params"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await crm.deleteLead(organizationId, req.params.id as string);
  await audit({ action: "lead.delete", organizationId, userId, entity: "Lead", entityId: req.params.id as string, req });
  res.status(204).end();
});

crmRouter.post("/leads/:id/notes", validate(id, "params"), validate(noteSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.status(201).json(await crm.addNote(organizationId, userId, req.params.id as string, req.body.body));
});

crmRouter.delete("/leads/:id/notes/:noteId", validate(noteParams, "params"), async (req, res) => {
  await crm.deleteNote(authOf(req).organizationId, req.params.id as string, req.params.noteId as string);
  res.status(204).end();
});

crmRouter.post("/leads/:id/activities", validate(id, "params"), validate(logActivitySchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await crm.logActivity(organizationId, userId, req.params.id as string, req.body.type, req.body.description);
  res.status(201).json({ ok: true });
});

crmRouter.get("/tasks", validate(listTasksQuery, "query"), async (req, res) => {
  res.json(await crm.listTasks(authOf(req).organizationId, req.query as unknown as z.infer<typeof listTasksQuery>));
});

crmRouter.post("/tasks", validate(taskSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.status(201).json(await crm.createTask(organizationId, userId, req.body));
});

crmRouter.patch("/tasks/:id", validate(id, "params"), validate(updateTaskSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.json(await crm.updateTask(organizationId, userId, req.params.id as string, req.body));
});

crmRouter.post("/tags", validate(tagSchema), async (req, res) => {
  res.status(201).json(await crm.createTag(authOf(req).organizationId, req.body.name, req.body.color));
});

// ── Encontrar Leads ──

crmRouter.get("/searches", async (req, res) => res.json(await crm.listSearches(authOf(req).organizationId)));

crmRouter.get("/searches/:id/results", validate(id, "params"), validate(pageQuery, "query"), async (req, res) => {
  const { page, pageSize } = req.query as unknown as z.infer<typeof pageQuery>;
  res.json(await crm.getSearchResults(authOf(req).organizationId, req.params.id as string, page, pageSize));
});

crmRouter.post("/import/preview", validate(importResultsSchema), async (req, res) => {
  res.json(await crm.previewImport(authOf(req).organizationId, req.body.resultIds));
});

crmRouter.post("/import", validate(importResultsSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const result = await crm.importResults(organizationId, userId, req.body.resultIds);
  await audit({ action: "lead.import", organizationId, userId, metadata: result, req });
  res.json(result);
});
