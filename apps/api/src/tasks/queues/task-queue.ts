import type { AgentTask } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/**
 * TaskQueueService. A implementação padrão usa o próprio PostgreSQL (FOR UPDATE SKIP LOCKED):
 * durável, transacional e sem infraestrutura extra. Um adaptador BullMQ/Redis pode implementar
 * a mesma interface quando REDIS_URL estiver disponível.
 */
export interface TaskQueue {
  /** Reserva a próxima tarefa pronta. Garante no máximo 1 tarefa RUNNING por agente. */
  claimNext(workerId: string): Promise<AgentTask | null>;
  /** Devolve à fila tarefas cujo worker morreu (heartbeat parado). */
  recoverStale(staleMs: number): Promise<number>;
}

export class PostgresTaskQueue implements TaskQueue {
  async claimNext(workerId: string): Promise<AgentTask | null> {
    return prisma.$transaction(async (tx) => {
      // 1) Trava um agente livre (não pausado, sem tarefa rodando) que tenha trabalho pronto.
      //    SKIP LOCKED faz workers concorrentes escolherem agentes diferentes.
      const agents = await tx.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM "Agent" a
         WHERE a.paused = false
           AND NOT EXISTS (SELECT 1 FROM "AgentTask" r WHERE r."agentId" = a.id AND r.status = 'RUNNING')
           AND EXISTS (SELECT 1 FROM "AgentTask" q WHERE q."agentId" = a.id AND q.status = 'QUEUED' AND q."runAfter" <= (now() AT TIME ZONE 'UTC'))
         ORDER BY (SELECT MIN(q.priority) FROM "AgentTask" q WHERE q."agentId" = a.id AND q.status = 'QUEUED'), a.id
         FOR UPDATE OF a SKIP LOCKED
         LIMIT 1`;
      const agentId = agents[0]?.id;
      if (!agentId) return null;

      // 2) Pega a tarefa mais prioritária desse agente e marca como RUNNING na mesma transação.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "AgentTask"
         WHERE "agentId" = ${agentId}::uuid AND status = 'QUEUED' AND "runAfter" <= (now() AT TIME ZONE 'UTC')
         ORDER BY priority ASC, "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`;
      const taskId = rows[0]?.id;
      if (!taskId) return null;

      const now = new Date();
      const task = await tx.agentTask.update({
        where: { id: taskId },
        data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, startedAt: now, controlRequest: null },
      });
      // O status visual do agente é recalculado pelo runner (refreshAgentStatus), que publica o evento.
      await tx.agent.update({ where: { id: agentId }, data: { lastActiveAt: now } });
      return task;
    });
  }

  async recoverStale(staleMs: number): Promise<number> {
    const { count } = await prisma.agentTask.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - staleMs) } },
      data: { status: "QUEUED", lockedAt: null, lockedBy: null },
    });
    return count;
  }
}
