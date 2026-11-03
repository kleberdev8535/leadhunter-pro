import type { Request } from "express";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import type { Prisma } from "../generated/prisma/client.js";

interface AuditInput {
  action: string;
  organizationId?: string | null;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
}

/** Auditoria nunca deve derrubar a requisição principal: falhas são apenas logadas. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata ?? {},
        ip: input.req?.ip?.slice(0, 64),
        userAgent: input.req?.get("user-agent")?.slice(0, 400),
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "falha ao gravar auditoria");
  }
}
