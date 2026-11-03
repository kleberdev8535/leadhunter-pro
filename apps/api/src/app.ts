import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter, CLIENT_HEADER } from "./modules/auth/auth.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { officeRouter } from "./office/office.routes.js";
import { integrationsRouter } from "./integrations/integrations.routes.js";
import { crmRouter } from "./modules/crm/crm.routes.js";
import { whatsappRouter } from "./whatsapp/whatsapp.routes.js";
import { workspaceRouter } from "./modules/workspace/workspace.routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Render/Railway ficam atrás de um proxy; necessário para req.ip e rate limit corretos.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", CLIENT_HEADER],
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      // Sinais úteis para monitoramento externo (UptimeRobot, Better Stack, health check do Railway/Render).
      const [tasksQueued, tasksRunning, messagesQueued] = await Promise.all([
        prisma.agentTask.count({ where: { status: "QUEUED" } }),
        prisma.agentTask.count({ where: { status: "RUNNING" } }),
        prisma.whatsAppMessage.count({ where: { status: "QUEUED" } }),
      ]);
      res.json({ status: "ok", database: "ok", uptimeSec: Math.round(process.uptime()), queues: { tasksQueued, tasksRunning, messagesQueued } });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/office", officeRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/crm", crmRouter);
  app.use("/api/whatsapp", whatsappRouter);
  app.use("/api/workspace", workspaceRouter);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
