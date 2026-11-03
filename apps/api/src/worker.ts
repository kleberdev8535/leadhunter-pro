// Processo dedicado aos agentes (opcional). Use com RUN_WORKERS=false na API para escalar separadamente.
// Os eventos em tempo real deste processo só chegam ao navegador quando houver um barramento
// compartilhado (Redis pub/sub) — até lá, prefira rodar os workers dentro da API (padrão).
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { TaskRunner } from "./tasks/services/task-runner.js";
import { PostgresTaskQueue } from "./tasks/queues/task-queue.js";
import { HANDLERS } from "./agents/workers/index.js";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
const runner = new TaskRunner({ handlers: HANDLERS, queue: new PostgresTaskQueue(), concurrency });
runner.start();
logger.info({ concurrency }, "processo de workers iniciado");

const stop = async () => {
  await runner.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
