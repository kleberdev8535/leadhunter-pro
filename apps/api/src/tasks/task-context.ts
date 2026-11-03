import type { AgentTask, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { officeEvents } from "../office/events/office-events.js";
import { StopSignal } from "./task.errors.js";
import type { FetchFn } from "../integrations/google-places/places.client.js";

export interface TaskDeps {
  fetch: FetchFn;
}

/** O que um worker pode fazer com a tarefa em execução. É a única ponte entre worker e fila. */
export interface TaskContext {
  task: AgentTask;
  organizationId: string;
  deps: TaskDeps;
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  /** Atualiza progresso (0–100), renova o heartbeat e verifica pausa/cancelamento. */
  progress(pct: number, checkpoint?: Prisma.InputJsonValue): Promise<void>;
  /** Ponto de verificação explícito: lança StopSignal se o usuário pediu pausa ou cancelamento. */
  checkpoint(): Promise<void>;
}

export function createTaskContext(task: AgentTask, deps: TaskDeps): TaskContext {
  const organizationId = task.organizationId;
  let lastPct = task.progress;

  const checkControl = async () => {
    const fresh = await prisma.agentTask.findUnique({ where: { id: task.id }, select: { controlRequest: true } });
    if (fresh?.controlRequest === "pause") throw new StopSignal("pause");
    if (fresh?.controlRequest === "cancel") throw new StopSignal("cancel");
  };

  return {
    task,
    organizationId,
    deps,
    async log(message, level = "info") {
      await prisma.agentTaskLog.create({ data: { organizationId, taskId: task.id, level, message: message.slice(0, 1000) } });
    },
    async progress(pct, checkpoint) {
      const value = Math.max(lastPct, Math.min(99, Math.round(pct)));
      lastPct = value;
      await prisma.agentTask.update({
        where: { id: task.id },
        data: { progress: value, lockedAt: new Date(), ...(checkpoint !== undefined ? { checkpoint } : {}) },
      });
      const payload = { taskId: task.id, agentId: task.agentId, progress: value };
      officeEvents.publish(organizationId, "task:progress", payload);
      officeEvents.publish(organizationId, "agent:task_progress", payload);
      await checkControl();
    },
    checkpoint: checkControl,
  };
}
