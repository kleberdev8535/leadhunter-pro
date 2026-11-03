import { hash, verify } from "@node-rs/argon2";
import { prisma } from "../../lib/prisma.js";
import { AppError, conflict, notFound, unauthorized } from "../../lib/errors.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { REFRESH_GRACE_MS, REFRESH_TTL_MS, signAccessToken } from "../../lib/tokens.js";
import { sendMail } from "../../lib/mailer.js";
import { env } from "../../config/env.js";
import { DEFAULT_STAGES } from "../crm/default-pipeline.js";
import { ensureAgents } from "../../agents/registry/agent-registry.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";
import type { MemberRole } from "../../generated/prisma/client.js";

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const RESET_TTL_MS = 30 * 60_000;

// Hash fixo usado quando o email não existe, para o tempo de resposta não revelar quais contas existem.
const DUMMY_HASH = await hash("dummy-password-for-timing", ARGON);

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

export const hashPassword = (plain: string) => hash(plain, ARGON);

function slugify(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  return `${base || "org"}-${suffix}`;
}

async function issueSession(
  userId: string,
  organizationId: string,
  role: MemberRole,
  client: ClientInfo,
): Promise<IssuedSession> {
  const refreshToken = randomToken(48);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const session = await prisma.session.create({
    data: {
      userId,
      organizationId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt: refreshExpiresAt,
      ip: client.ip?.slice(0, 64),
      userAgent: client.userAgent?.slice(0, 400),
    },
  });
  const accessToken = await signAccessToken({ sub: userId, org: organizationId, role, sid: session.id });
  return { accessToken, refreshToken, refreshExpiresAt, sessionId: session.id };
}

export async function register(input: RegisterInput, client: ClientInfo) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict("Já existe uma conta com este email");

  const passwordHash = await hashPassword(input.password);
  const { user, org } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug: slugify(input.organizationName), settings: { create: {} } },
    });
    const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    const pipeline = await tx.pipeline.create({
      data: { organizationId: org.id, name: "Prospecção", isDefault: true },
    });
    await tx.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((s, position) => ({ ...s, position, organizationId: org.id, pipelineId: pipeline.id })),
    });
    await tx.leadSource.createMany({
      data: [
        { organizationId: org.id, type: "GOOGLE_MAPS", label: "Google Maps" },
        { organizationId: org.id, type: "MANUAL", label: "Cadastro manual" },
      ],
    });
    return { user, org };
  });

  await ensureAgents(org.id);
  const session = await issueSession(user.id, org.id, "OWNER", client);
  return { userId: user.id, organizationId: org.id, session };
}

export type LoginResult =
  | { ok: true; userId: string; organizationId: string; session: IssuedSession }
  | { ok: false; reason: "invalid" | "locked"; userId?: string };

export async function login(input: LoginInput, client: ClientInfo): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  if (!user || user.deletedAt) {
    await verify(DUMMY_HASH, input.password).catch(() => false);
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, reason: "locked", userId: user.id };
  }

  const valid = await verify(user.passwordHash, input.password).catch(() => false);
  if (!valid) {
    // Incremento atômico para tentativas paralelas não "perderem" falhas.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      });
      return { ok: false, reason: "locked", userId: user.id };
    }
    return { ok: false, reason: "invalid", userId: user.id };
  }

  const membership = user.memberships[0];
  if (!membership) throw new AppError(403, "NO_ORGANIZATION", "Usuário sem organização");

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const session = await issueSession(user.id, membership.organizationId, membership.role, client);
  return { ok: true, userId: user.id, organizationId: membership.organizationId, session };
}

/**
 * Troca o refresh token por um novo (rotação). O token anterior só vale dentro de uma janela curta
 * (requisições simultâneas de abas diferentes); fora dela, reuso indica vazamento e a sessão é revogada.
 */
export async function refresh(
  refreshToken: string,
  client: ClientInfo,
): Promise<IssuedSession & { userId: string; organizationId: string }> {
  const tokenHash = sha256(refreshToken);
  let session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });

  if (!session) {
    const reused = await prisma.session.findUnique({ where: { previousTokenHash: tokenHash } });
    if (!reused) throw unauthorized("Sessão inválida");
    const withinGrace = reused.rotatedAt !== null && Date.now() - reused.rotatedAt.getTime() < REFRESH_GRACE_MS;
    if (!withinGrace) {
      await prisma.session.update({ where: { id: reused.id }, data: { revokedAt: new Date() } });
      throw new AppError(401, "TOKEN_REUSED", "Sessão encerrada por segurança. Faça login novamente.");
    }
    session = reused;
  }

  if (session.revokedAt || session.expiresAt < new Date()) throw unauthorized("Sessão expirada");

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
  });
  if (!membership) throw unauthorized("Sessão inválida");

  const next = randomToken(48);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const usedCurrent = session.refreshTokenHash === tokenHash;
  await prisma.session.update({
    where: { id: session.id },
    data: {
      // Na janela de tolerância mantemos o "anterior" original, para não estender a janela indefinidamente.
      previousTokenHash: usedCurrent ? tokenHash : session.previousTokenHash,
      rotatedAt: usedCurrent ? new Date() : session.rotatedAt,
      refreshTokenHash: sha256(next),
      lastUsedAt: new Date(),
      expiresAt: refreshExpiresAt,
      ip: client.ip?.slice(0, 64),
      userAgent: client.userAgent?.slice(0, 400),
    },
  });
  const accessToken = await signAccessToken({
    sub: session.userId,
    org: session.organizationId,
    role: membership.role,
    sid: session.id,
  });
  return {
    accessToken,
    refreshToken: next,
    refreshExpiresAt,
    sessionId: session.id,
    userId: session.userId,
    organizationId: session.organizationId,
  };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const tokenHash = sha256(refreshToken);
  await prisma.session.updateMany({
    where: { OR: [{ refreshTokenHash: tokenHash }, { previousTokenHash: tokenHash }], revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** A resposta HTTP é sempre a mesma, exista ou não a conta. */
export async function requestPasswordReset(email: string): Promise<{ userId?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return {};
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);
  const link = `${env.APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Redefinição de senha — LeadHunter Pro",
    text: `Olá, ${user.name}.\n\nPara criar uma nova senha, acesse:\n${link}\n\nO link vale por 30 minutos. Se não foi você, ignore este email.`,
  });
  return { userId: user.id };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ userId: string }> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError(400, "INVALID_TOKEN", "Link inválido ou expirado. Solicite um novo.");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return { userId: record.userId };
}

export async function changePassword(userId: string, currentSessionId: string, current: string, next: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  const valid = await verify(user.passwordHash, current).catch(() => false);
  if (!valid) throw new AppError(400, "INVALID_PASSWORD", "Senha atual incorreta");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } }),
    // Mantém a sessão atual e encerra as demais.
    prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function updateProfile(userId: string, data: { name: string; avatarUrl?: string | null }) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
}

export async function getMe(userId: string, organizationId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!membership) throw notFound();
  return { user: membership.user, organization: membership.organization, role: membership.role };
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw notFound("Sessão não encontrada");
}

export async function listAccessHistory(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId, action: { startsWith: "auth." } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, ip: true, userAgent: true, createdAt: true },
  });
}
