import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { attachSocketGateway } from "./office/gateway/socket-gateway.js";
import { TaskRunner } from "./tasks/services/task-runner.js";
import { PostgresTaskQueue } from "./tasks/queues/task-queue.js";
import { HANDLERS } from "./agents/workers/index.js";
import { purgeExpiredSearchResults } from "./modules/crm/crm.service.js";
import { activeProvider, restoreConnections, stopAll as stopWhatsApp } from "./whatsapp/whatsapp.service.js";
import { dispatchDue } from "./whatsapp/messages.service.js";
import { generateTaskNotifications } from "./modules/workspace/workspace.service.js";

const server = createServer(createApp());
const gateway = attachSocketGateway(server);

// Com RUN_WORKERS=false a API só atende HTTP e os agentes rodam em outro processo (src/worker.ts).
const runner = process.env.RUN_WORKERS === "false" ? null : new TaskRunner({ handlers: HANDLERS, queue: new PostgresTaskQueue() });

server.listen(env.PORT, () => {
  logger.info(`API LeadHunter Pro em http://localhost:${env.PORT}`);
  runner?.start();
  // Política da Places API: resultados não importados ficam no máximo 30 dias.
  const purge = () => purgeExpiredSearchResults().then((n) => n && logger.info({ n }, "resultados de busca expirados removidos")).catch((err) => logger.error({ err }, "falha na limpeza"));
  void purge();
  setInterval(purge, 24 * 3_600_000).unref();
  // WhatsApp: retoma sessões salvas e despacha a fila respeitando intervalo/limite.
  void restoreConnections().catch((err) => logger.error({ err }, "falha ao restaurar WhatsApp"));
  let dispatching = false;
  setInterval(() => {
    if (dispatching) return;
    dispatching = true;
    void dispatchDue(activeProvider).catch((err) => logger.error({ err }, "falha no despacho")).finally(() => (dispatching = false));
  }, 3000).unref();
  // Lembretes de tarefas (follow-ups) a cada minuto.
  setInterval(() => void generateTaskNotifications().catch((err) => logger.error({ err }, "falha nos lembretes")), 60_000).unref();
});

async function shutdown(signal: string) {
  logger.info({ signal }, "encerrando");
  // Para de pegar tarefas e espera as que estão rodando terminarem o passo atual.
  await runner?.stop();
  await stopWhatsApp();
  await gateway.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
