import type { Agent, AgentStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { officeEvents } from "../../office/events/office-events.js";
import { AGENT_REGISTRY } from "../registry/agent-registry.js";

export function serializeAgent(agent: Agent) {
  const def = AGENT_REGISTRY[agent.kind];
  const finished = agent.tasksCompleted + agent.tasksFailed;
  return {
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    role: def.role,
    station: def.station,
    supports: def.supports,
    status: agent.status,
    paused: agent.paused,
    currentTaskId: agent.currentTaskId,
    tasksCompleted: agent.tasksCompleted,
    tasksFailed: agent.tasksFailed,
    avgRunMs: agent.tasksCompleted === 0 ? 0 : Math.round(Number(agent.totalRunMs) / agent.tasksCompleted),
    successRate: finished === 0 ? null : Math.round((agent.tasksCompleted / finished) * 1000) / 10,
    lastActiveAt: agent.lastActiveAt,
  };
}
export type SerializedAgent = ReturnType<typeof serializeAgent>;

/**
 * AgentStatusService: o status do agente é DERIVADO do estado das tarefas no banco, nunca
 * escolhido à mão. Assim o boneco no escritório só aparece trabalhando se houver tarefa RUNNING.
 */
export async function refreshAgentStatus(agentId: string, opts: { failed?: boolean } = {}) {
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
  const [running, ready, waiting] = await Promise.all([
    prisma.agentTask.findFirst({ where: { agentId, status: "RUNNING" }, select: { id: true } }),
    prisma.agentTask.count({ where: { agentId, status: "QUEUED", runAfter: { lte: new Date() } } }),
    prisma.agentTask.count({ where: { agentId, status: "QUEUED", runAfter: { gt: new Date() } } }),
  ]);

  let status: AgentStatus;
  if (running) status = "WORKING";
  else if (agent.paused) status = "PAUSED";
  else if (ready > 0) status = "ASSIGNED";
  else if (waiting > 0) status = "WAITING";
  else if (opts.failed || agent.status === "ERROR") status = "ERROR";
  else status = "AVAILABLE";

  const currentTaskId = running?.id ?? null;
  if (status === agent.status && currentTaskId === agent.currentTaskId) return agent;

  const updated = await prisma.agent.update({ where: { id: agentId }, data: { status, currentTaskId } });
  officeEvents.publish(agent.organizationId, "agent:status_changed", {
    agent: serializeAgent(updated),
    previous: agent.status,
  });
  return updated;
}
