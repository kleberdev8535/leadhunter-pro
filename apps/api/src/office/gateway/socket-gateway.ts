import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import { officeEvents, type OfficeEvent } from "../events/office-events.js";

/**
 * Gateway em tempo real. O cliente se autentica com o mesmo access token da API;
 * cada socket entra só na sala da própria organização, então eventos nunca vazam entre empresas.
 */
export function attachSocketGateway(server: HttpServer) {
  const io = new Server(server, {
    path: "/api/socket.io",
    cors: { origin: env.corsOrigins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("UNAUTHORIZED"));
      const claims = await verifyAccessToken(token);
      const session = await prisma.session.findUnique({ where: { id: claims.sid }, select: { revokedAt: true, expiresAt: true } });
      if (!session || session.revokedAt || session.expiresAt < new Date()) return next(new Error("UNAUTHORIZED"));
      socket.data.organizationId = claims.org;
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    void socket.join(`org:${socket.data.organizationId as string}`);
  });

  const forward = (e: OfficeEvent) => io.to(`org:${e.organizationId}`).emit(e.name, e.payload);
  officeEvents.on("event", forward);
  logger.info("gateway Socket.IO ativo em /api/socket.io");

  return {
    io,
    close: async () => {
      officeEvents.off("event", forward);
      await io.close();
    },
  };
}
