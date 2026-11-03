import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { authOf, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NICHES } from "../agents/niches.js";
import { AGENT_REGISTRY } from "../agents/registry/agent-registry.js";
import { MAX_RESULTS_PER_QUERY } from "../integrations/google-places/places.client.js";
import { createTaskSchema, listTasksQuery } from "../tasks/task.schemas.js";
import * as tasks from "../tasks/services/task.service.js";
import * as team from "../team/team.service.js";
import { searchLeadsParams } from "../tasks/task.schemas.js";

const idParams = z.object({ id: z.string().uuid() });
const retryBody = z.object({ idempotencyKey: z.string().trim().min(8).max(100) });
const agentPatch = z.object({ paused: z.boolean() });

export const officeRouter = Router();
officeRouter.use(requireAuth);

officeRouter.get("/catalog", (_req, res) => {
  res.json({
    niches: NICHES.map(({ key, label }) => ({ key, label })),
    agents: Object.values(AGENT_REGISTRY).map(({ kind, name, role, supports, station }) => ({ kind, name, role, supports, station })),
    limits: { maxResultsPerQuery: MAX_RESULTS_PER_QUERY },
  });
});

officeRouter.get("/agents", async (req, res) => {
  res.json(await tasks.listAgents(authOf(req).organizationId));
});

officeRouter.patch("/agents/:id", requireRole("OWNER", "ADMIN"), validate(idParams, "params"), validate(agentPatch), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const agent = await tasks.setAgentPaused(organizationId, req.params.id as string, req.body.paused);
  await audit({ action: req.body.paused ? "agent.paused" : "agent.resumed", organizationId, userId, entity: "Agent", entityId: agent.id, req });
  res.json(agent);
});

officeRouter.get("/stats", async (req, res) => {
  res.json(await tasks.officeStats(authOf(req).organizationId));
});

officeRouter.get("/tasks", validate(listTasksQuery, "query"), async (req, res) => {
  res.json(await tasks.listTasks(authOf(req).organizationId, req.query as unknown as z.infer<typeof listTasksQuery>));
});

officeRouter.get("/tasks/:id", validate(idParams, "params"), async (req, res) => {
  res.json(await tasks.getTask(authOf(req).organizationId, req.params.id as string));
});

officeRouter.post("/tasks", validate(createTaskSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const { task, created } = await tasks.createTask(organizationId, userId, req.body);
  if (created) await audit({ action: "task.created", organizationId, userId, entity: "AgentTask", entityId: task.id, metadata: { taskType: task.taskType }, req });
  res.status(created ? 201 : 200).json(task);
});

for (const action of ["pause", "resume", "cancel"] as const) {
  officeRouter.post(`/tasks/:id/${action}`, validate(idParams, "params"), async (req, res) => {
    const { organizationId, userId } = authOf(req);
    const id = req.params.id as string;
    const fn = action === "pause" ? tasks.pauseTask : action === "resume" ? tasks.resumeTask : tasks.cancelTask;
    const task = await fn(organizationId, id);
    await audit({ action: `task.${action}`, organizationId, userId, entity: "AgentTask", entityId: id, req });
    res.json(task);
  });
}

officeRouter.post("/tasks/:id/retry", validate(idParams, "params"), validate(retryBody), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const { task, created } = await tasks.retryTask(organizationId, userId, req.params.id as string, req.body.idempotencyKey);
  await audit({ action: "task.retry", organizationId, userId, entity: "AgentTask", entityId: task.id, req });
  res.status(created ? 201 : 200).json(task);
});

const logsQuery = z.object({ agentId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(80) });

officeRouter.get("/logs", validate(logsQuery, "query"), async (req, res) => {
  const { agentId, limit } = req.query as unknown as z.infer<typeof logsQuery>;
  res.json(await tasks.recentLogs(authOf(req).organizationId, limit, agentId));
});

// ── Missões da equipe (Hunter → Scout → Atlas → Writer → Metrics) ──
const teamRunSchema = z.object({
  search: searchLeadsParams,
  minScore: z.number().int().min(0).max(100).default(40),
  messageKind: z.enum(["INITIAL", "NO_WEBSITE"]).default("INITIAL"),
  writeMessages: z.boolean().default(true),
  report: z.boolean().default(true),
  description: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

officeRouter.get("/team-runs", async (req, res) => {
  res.json(await team.listTeamRuns(authOf(req).organizationId));
});

officeRouter.get("/team-runs/:id", validate(idParams, "params"), async (req, res) => {
  res.json(await team.getTeamRun(authOf(req).organizationId, req.params.id as string));
});

officeRouter.post("/team-runs", validate(teamRunSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const { run, created } = await team.createTeamRun(organizationId, userId, req.body);
  if (created) await audit({ action: "team.run_started", organizationId, userId, entity: "TeamRun", entityId: run.id, req });
  res.status(created ? 201 : 200).json(run);
});

officeRouter.post("/team-runs/:id/cancel", validate(idParams, "params"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const run = await team.cancelTeamRun(organizationId, req.params.id as string);
  await audit({ action: "team.run_cancelled", organizationId, userId, entity: "TeamRun", entityId: run.id, req });
  res.json(run);
});
