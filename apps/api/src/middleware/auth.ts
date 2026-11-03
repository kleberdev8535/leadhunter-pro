import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";
import type { MemberRole } from "../generated/prisma/client.js";

export interface AuthContext {
  userId: string;
  organizationId: string;
  role: MemberRole;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Exige access token válido E sessão ativa no banco, para que revogar uma sessão
 * (logout, troca de senha, "encerrar sessão") tenha efeito imediato.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const claims = await verifyAccessToken(header.slice(7)).catch(() => {
      throw unauthorized("Sessão expirada");
    });
    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      select: { userId: true, organizationId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) {
      throw unauthorized("Sessão encerrada");
    }
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: claims.sub, organizationId: claims.org } },
      select: { role: true },
    });
    if (!membership) throw forbidden("Você não pertence a esta organização");
    req.auth = { userId: claims.sub, organizationId: claims.org, role: membership.role, sessionId: claims.sid };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole =
  (...roles: MemberRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

/** Atalho tipado para handlers que já passaram por requireAuth. */
export function authOf(req: Express.Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
