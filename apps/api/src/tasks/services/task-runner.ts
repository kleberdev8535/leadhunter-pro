import { randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskType, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { officeEvents } from "../../office/events/office-events.js";
import { refreshAgentStatus } from "../../agents/services/agent-status.service.js";
import { backoffMs, StopSignal } from "../task.errors.js";
import { createTaskContext, type TaskContext, type TaskDeps } from "../task-context.js";
import { serializeTask } from "./task.service.js";
import { syncTeamRun } from "../../team/team.service.js";

export type TaskHandler = (ctx: TaskContext) => Promise<Prisma.InputJsonValue>;
export type HandlerMap = Record<AgentTaskType, TaskHandler>;

interface RunnerOptions {
  handlers: HandlerMap;
  queue: { claimNext(workerId: string): Promise<AgentTask | null>; recoverStale(ms: number): Promise<number> };
  deps?: Partial<TaskDeps>;
  concurrency?: number;
  pollMs?: number;
  staleMs?: number;
}

/**
 * TaskExecutionService. Roda no processo da API (ou separado, via src/worker.ts) e não depende
 * do navegador: fechar a página não interrompe nada. Limite de concorrência global + 1 por agente.
 */
export class TaskRunner {
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private active = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly inflight = new Set<Promise<void>>();
  private readonly deps: TaskDeps;

  constructor(private readonly opts: RunnerOptions) {
    this.deps = { fetch: globalThis.fetch.bind(globalThis), ...opts.deps };
  }

  start() {
    this.stopping = false;
    void this.opts.queue.recoverStale(this.opts.staleMs ?? 10 * 60_000).then((n) => {
      if (n) logger.warn({ n }, "tarefas presas devolvidas à fila");
    });
    const loop = async () => {
      if (this.stopping) return;
      try {
        await this.fill();
      } catch (err) {
        logger.error({ err }, "falha no loop do runner");
      }
      this.timer = setTimeout(loop, this.opts.pollMs ?? 1000);
    };
    void loop();
    logger.info({ workerId: this.workerId }, "runner de tarefas iniciado");
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  /** Ocupa os slots livres de concorrência. */
  private async fill() {
    const max = this.opts.concurrency ?? 3;
    while (this.active < max) {
      const task = await this.opts.queue.claimNext(this.workerId);
      if (!task) return;
      this.active++;
      const p = this.execute(task).finally(() => {
        this.active--;
        this.inflight.delete(p);
      });
      this.inflight.add(p);
    }
  }

  /** Para testes: executa uma tarefa pronta até o fim. Retorna false se a fila está vazia. */
  async runOnce(): Promise<boolean> {
    const task = await this.opts.queue.claimNext(this.workerId);
    if (!task) return false;
    await this.execute(task);
    return true;
  }

  private async execute(task: AgentTask) {
    const org = task.organizationId;
    const ctx = createTaskContext(task, this.deps);
    const started = Date.now();
    await refreshAgentStatus(task.agentId);
    const startedPayload = { task: serializeTask(task) };
    officeEvents.publish(org, "task:started", startedPayload);
    officeEvents.publish(org, "agent:task_started", { agentId: task.agentId, taskId: task.id });
    await ctx.log(task.retryCount > 0 ? `Tentativa ${task.retryCount + 1} iniciada` : "Execução iniciada");

    try {
      const handler = this.opts.handlers[task.taskType];
      const result = await handler(ctx);
      const done = await prisma.agentTask.update({
        where: { id: task.id },
        data: { status: "COMPLETED", progress: 100, result, completedAt: new Date(), lockedAt: null, lockedBy: null, controlRequest: null },
        include: { agent: true },
      });
      await prisma.agent.update({
        where: { id: task.agentId },
        data: { tasksCompleted: { increment: 1 }, totalRunMs: { increment: BigInt(Date.now() - started) }, status: "COMPLETED" },
      });
      await ctx.log("Tarefa concluída");
      officeEvents.publish(org, "task:completed", { task: serializeTask(done) });
      officeEvents.publish(org, "agent:task_completed", { agentId: task.agentId, taskId: task.id });
      await refreshAgentStatus(task.agentId);
      await syncTeamRun(task.id);
    } catch (err) {
      if (err instanceof StopSignal) return this.stopped(task, err.kind);
      await this.failed(task, err as Error, ctx);
    }
  }

  private async stopped(task: AgentTask, kind: "pause" | "cancel") {
    const status = kind === "pause" ? "PAUSED" : "CANCELLED";
    const updated = await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status,
        controlRequest: null,
        lockedAt: null,
        lockedBy: null,
        ...(kind === "cancel" ? { completedAt: new Date() } : {}),
      },
      include: { agent: true },
    });
    await prisma.agentTaskLog.create({
      data: { organizationId: task.organizationId, taskId: task.id, level: "warn", message: kind === "pause" ? "Pausada pelo usuário (progresso salvo)" : "Cancelada pelo usuário" },
    });
    officeEvents.publish(task.organizationId, kind === "pause" ? "task:paused" : "task:cancelled", { task: serializeTask(updated) });
    await refreshAgentStatus(task.agentId);
    await syncTeamRun(task.id);
  }

  private async failed(task: AgentTask, err: Error, ctx: TaskContext) {
    const retryable = (err as { retryable?: boolean }).retryable === true;
    const canRetry = retryable && task.retryCount < task.maxRetries;
    const message = err.message.slice(0, 1000) || "Erro desconhecido";
    if (!retryable && !(err as { retryable?: boolean }).hasOwnProperty("retryable")) {
      logger.error({ err, taskId: task.id }, "erro inesperado em tarefa");
    }

    if (canRetry) {
      const delay = backoffMs(task.retryCount);
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: "QUEUED",
          retryCount: { increment: 1 },
          runAfter: new Date(Date.now() + delay),
          errorMessage: message,
          lockedAt: null,
          lockedBy: null,
        },
      });
      await ctx.log(`${message} — nova tentativa em ${Math.round(delay / 1000)}s`, "warn");
      await refreshAgentStatus(task.agentId);
      return;
    }

    const failed = await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date(), lockedAt: null, lockedBy: null, controlRequest: null },
      include: { agent: true },
    });
    await prisma.agent.update({ where: { id: task.agentId }, data: { tasksFailed: { increment: 1 } } });
    await ctx.log(message, "error");
    officeEvents.publish(task.organizationId, "task:failed", { task: serializeTask(failed) });
    officeEvents.publish(task.organizationId, "agent:task_failed", { agentId: task.agentId, taskId: task.id, error: message });
    await refreshAgentStatus(task.agentId, { failed: true });
    await syncTeamRun(task.id);
  }
}
