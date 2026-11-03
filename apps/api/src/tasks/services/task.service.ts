import type { AgentTask, AgentTaskStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { officeEvents } from "../../office/events/office-events.js";
import { agentForTask, ensureAgents } from "../../agents/registry/agent-registry.js";
import { refreshAgentStatus, serializeAgent } from "../../agents/services/agent-status.service.js";
import { nicheByKey } from "../../agents/niches.js";
import type { CreateTaskInput } from "../task.schemas.js";

export function serializeTask(t: AgentTask & { agent?: { name: string; kind: string } }) {
  return {
    id: t.id,
    agentId: t.agentId,
    agentName: t.agent?.name,
    agentKind: t.agent?.kind,
    taskType: t.taskType,
    title: t.title,
    description: t.description,
    parameters: t.parameters,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    result: t.result,
    errorMessage: t.errorMessage,
    retryCount: t.retryCount,
    maxRetries: t.maxRetries,
    runAfter: t.runAfter,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    controlRequest: t.controlRequest,
  };
}

const TITLE: Record<CreateTaskInput["taskType"], string> = {
  SEARCH_LEADS: "Buscar leads no Google Maps",
  QUALIFY_LEADS: "Qualificar leads",
  IMPORT_TO_CRM: "Importar leads para o CRM",
  GENERATE_MESSAGES: "Gerar mensagens comerciais",
  GENERATE_REPORT: "Gerar relatório de prospecção",
  UPDATE_LEADS: "Atualizar dados de leads",
};

function defaultTitle(input: CreateTaskInput): string {
  switch (input.taskType) {
    case "SEARCH_LEADS": {
      const p = input.parameters;
      const names = p.niches.map((k) => nicheByKey(k)?.label ?? k).join(", ");
      const site = p.website === "without" ? " sem site informado" : p.website === "with" ? " com site" : "";
      return `Buscar ${p.quantity} ${names}${site} em ${p.city}/${p.state}`;
    }
    case "GENERATE_REPORT":
      return `Relatório de prospecção (${input.parameters.days} dias)`;
    default:
      return TITLE[input.taskType];
  }
}

export async function createTask(organizationId: string, userId: string, input: CreateTaskInput) {
  await ensureAgents(organizationId);
  const kind = agentForTask(input.taskType);
  const agent = await prisma.agent.findUniqueOrThrow({ where: { organizationId_kind: { organizationId, kind } } });

  // Dependências entre agentes são checadas na criação para falhar cedo e com mensagem clara.
  if (input.taskType === "IMPORT_TO_CRM" || (input.taskType === "QUALIFY_LEADS" && input.parameters.source.kind === "search")) {
    const searchTaskId =
      input.taskType === "IMPORT_TO_CRM"
        ? input.parameters.searchTaskId
        : (input.parameters.source as { searchTaskId: string }).searchTaskId;
    const source = await prisma.agentTask.findFirst({ where: { id: searchTaskId, organizationId, taskType: "SEARCH_LEADS" } });
    if (!source) throw badRequest("A busca de origem não existe nesta organização");
    if (source.status !== "COMPLETED") throw badRequest("A busca de origem ainda não foi concluída");
  }

  const existing = await prisma.agentTask.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey } },
    include: { agent: true },
  });
  if (existing) return { task: serializeTask(existing), created: false };

  let task;
  try {
    task = await prisma.agentTask.create({
      data: {
        organizationId,
        agentId: agent.id,
        createdById: userId,
        taskType: input.taskType,
        title: input.title || defaultTitle(input),
        description: input.description,
        parameters: input.parameters as Prisma.InputJsonValue,
        priority: input.priority,
        status: "QUEUED",
        idempotencyKey: input.idempotencyKey,
      },
      include: { agent: true },
    });
  } catch (err) {
    // Corrida entre dois envios simultâneos com a mesma chave.
    if ((err as { code?: string }).code === "P2002") {
      const again = await prisma.agentTask.findUniqueOrThrow({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey } },
        include: { agent: true },
      });
      return { task: serializeTask(again), created: false };
    }
    throw err;
  }

  const payload = { task: serializeTask(task) };
  officeEvents.publish(organizationId, "task:created", payload);
  officeEvents.publish(organizationId, "task:queued", payload);
  officeEvents.publish(organizationId, "agent:task_assigned", { agentId: agent.id, taskId: task.id });
  await refreshAgentStatus(agent.id);
  return { task: serializeTask(task), created: true };
}

async function loadTask(organizationId: string, id: string) {
  const task = await prisma.agentTask.findFirst({ where: { id, organizationId }, include: { agent: true } });
  if (!task) throw notFound("Tarefa não encontrada");
  return task;
}

async function transition(task: AgentTask, status: AgentTaskStatus, event: "task:paused" | "task:cancelled" | "task:queued", extra: Prisma.AgentTaskUpdateInput = {}) {
  const updated = await prisma.agentTask.update({ where: { id: task.id }, data: { status, ...extra }, include: { agent: true } });
  officeEvents.publish(task.organizationId, event, { task: serializeTask(updated) });
  await refreshAgentStatus(task.agentId);
  if (updated.teamRunId) {
    // Import dinâmico: team.service depende deste arquivo.
    const { syncTeamRun } = await import("../../team/team.service.js");
    await syncTeamRun(updated.id);
  }
  return serializeTask(updated);
}

export async function pauseTask(organizationId: string, id: string) {
  const task = await loadTask(organizationId, id);
  if (task.status === "QUEUED") return transition(task, "PAUSED", "task:paused");
  if (task.status === "RUNNING") {
    // O worker para no próximo ponto de verificação e salva o checkpoint.
    const updated = await prisma.agentTask.update({ where: { id }, data: { controlRequest: "pause" }, include: { agent: true } });
    return serializeTask(updated);
  }
  throw conflict(`Não é possível pausar uma tarefa ${task.status.toLowerCase()}`);
}

export async function resumeTask(organizationId: string, id: string) {
  const task = await loadTask(organizationId, id);
  if (task.status !== "PAUSED") throw conflict("Só tarefas pausadas podem ser retomadas");
  return transition(task, "QUEUED", "task:queued", { controlRequest: null, runAfter: new Date() });
}

export async function cancelTask(organizationId: string, id: string) {
  const task = await loadTask(organizationId, id);
  if (task.status === "QUEUED" || task.status === "PAUSED" || task.status === "PENDING") {
    return transition(task, "CANCELLED", "task:cancelled", { completedAt: new Date() });
  }
  if (task.status === "RUNNING") {
    const updated = await prisma.agentTask.update({ where: { id }, data: { controlRequest: "cancel" }, include: { agent: true } });
    return serializeTask(updated);
  }
  throw conflict(`Não é possível cancelar uma tarefa ${task.status.toLowerCase()}`);
}

/** Reexecutar cria uma tarefa nova com os mesmos parâmetros, preservando o histórico da original. */
export async function retryTask(organizationId: string, userId: string, id: string, idempotencyKey: string) {
  const task = await loadTask(organizationId, id);
  if (!["FAILED", "CANCELLED", "COMPLETED"].includes(task.status)) throw conflict("Só tarefas finalizadas podem ser reexecutadas");
  return createTask(organizationId, userId, {
    taskType: task.taskType,
    parameters: task.parameters,
    title: task.title,
    description: task.description ?? undefined,
    priority: task.priority,
    idempotencyKey,
  } as CreateTaskInput);
}

export async function listTasks(
  organizationId: string,
  q: { status?: AgentTaskStatus; agentId?: string; q?: string; limit: number },
) {
  const tasks = await prisma.agentTask.findMany({
    where: {
      organizationId,
      status: q.status,
      agentId: q.agentId,
      ...(q.q ? { title: { contains: q.q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit,
    include: { agent: true },
  });
  return tasks.map(serializeTask);
}

export async function getTask(organizationId: string, id: string) {
  const task = await loadTask(organizationId, id);
  const logs = await prisma.agentTaskLog.findMany({ where: { taskId: id }, orderBy: { createdAt: "asc" }, take: 500 });
  return { ...serializeTask(task), logs: logs.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt })) };
}

export async function listAgents(organizationId: string) {
  await ensureAgents(organizationId);
  const agents = await prisma.agent.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  const order = ["HUNTER", "SCOUT", "ATLAS", "WRITER", "METRICS"];
  return agents.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map(serializeAgent);
}

export async function setAgentPaused(organizationId: string, agentId: string, paused: boolean) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId } });
  if (!agent) throw notFound("Agente não encontrado");
  await prisma.agent.update({ where: { id: agentId }, data: { paused } });
  if (paused && agent.currentTaskId) {
    await prisma.agentTask.updateMany({ where: { id: agent.currentTaskId, status: "RUNNING" }, data: { controlRequest: "pause" } });
  }
  return serializeAgent(await refreshAgentStatus(agentId));
}

export async function officeStats(organizationId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [agents, byStatus, completedToday, finishedToday, durations] = await Promise.all([
    prisma.agent.findMany({ where: { organizationId }, select: { status: true } }),
    prisma.agentTask.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    prisma.agentTask.count({ where: { organizationId, status: "COMPLETED", completedAt: { gte: startOfDay } } }),
    prisma.agentTask.count({ where: { organizationId, status: { in: ["COMPLETED", "FAILED"] }, completedAt: { gte: startOfDay } } }),
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000)::float AS avg
        FROM "AgentTask" WHERE "organizationId" = ${organizationId}::uuid AND status = 'COMPLETED' AND "startedAt" IS NOT NULL`,
  ]);
  const count = (s: AgentTaskStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  return {
    agentsOnline: agents.filter((a) => a.status !== "OFFLINE").length,
    agentsWorking: agents.filter((a) => a.status === "WORKING").length,
    agentsAvailable: agents.filter((a) => a.status === "AVAILABLE" || a.status === "IDLE").length,
    tasksRunning: count("RUNNING"),
    tasksQueued: count("QUEUED") + count("PENDING"),
    tasksPaused: count("PAUSED"),
    tasksFailed: count("FAILED"),
    completedToday,
    successRateToday: finishedToday === 0 ? null : Math.round((completedToday / finishedToday) * 1000) / 10,
    avgRunMs: Math.round(durations[0]?.avg ?? 0),
  };
}

export async function recentLogs(organizationId: string, limit: number, agentId?: string) {
  const logs = await prisma.agentTaskLog.findMany({
    where: { organizationId, ...(agentId ? { task: { agentId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { task: { select: { id: true, title: true, agent: { select: { name: true, kind: true } } } } },
  });
  return logs.map((l) => ({
    id: l.id,
    level: l.level,
    message: l.message,
    createdAt: l.createdAt,
    taskId: l.task.id,
    taskTitle: l.task.title,
    agentName: l.task.agent.name,
    agentKind: l.task.agent.kind,
  }));
}
