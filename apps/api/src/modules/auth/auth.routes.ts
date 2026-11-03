import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from "express";
import { env } from "../../config/env.js";
import { audit } from "../../lib/audit.js";
import { AppError, forbidden } from "../../lib/errors.js";
import { authLimiter } from "../../middleware/rate-limit.js";
import { authOf, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { LOCK_MINUTES } from "./auth.service.js";
import * as auth from "./auth.service.js";
import {
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  registerSchema,
  resetSchema,
  sessionIdParams,
  updateProfileSchema,
} from "./auth.schemas.js";

export const REFRESH_COOKIE = "lh_rt";
export const CLIENT_HEADER = "x-lh-client";

// Em produção frontend (Vercel) e API (Render/Railway) ficam em domínios diferentes: SameSite=None + Secure.
const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? "none" : "lax",
  path: "/api/auth",
  expires,
});

const client = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") });

/**
 * Rotas que dependem só do cookie exigem um header customizado: navegadores não o enviam em
 * requisições cross-site sem preflight CORS, o que bloqueia CSRF.
 */
const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (req.get(CLIENT_HEADER) !== "web") return next(forbidden("Cliente inválido"));
  next();
};

function sendSession(res: Response, status: number, session: auth.IssuedSession) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt));
  res.status(status).json({ accessToken: session.accessToken });
}

export const authRouter = Router();

authRouter.post("/register", authLimiter, validate(registerSchema), async (req, res) => {
  const result = await auth.register(req.body, client(req));
  await audit({ action: "auth.register", userId: result.userId, organizationId: result.organizationId, req });
  sendSession(res, 201, result.session);
});

authRouter.post("/login", authLimiter, validate(loginSchema), async (req, res) => {
  const result = await auth.login(req.body, client(req));
  if (!result.ok) {
    await audit({
      action: result.reason === "locked" ? "auth.login_locked" : "auth.login_failed",
      userId: result.userId,
      metadata: { email: req.body.email },
      req,
    });
    if (result.reason === "locked") {
      throw new AppError(
        429,
        "ACCOUNT_LOCKED",
        `Muitas tentativas incorretas. Conta bloqueada temporariamente por ${LOCK_MINUTES} minutos.`,
      );
    }
    throw new AppError(401, "INVALID_CREDENTIALS", "Email ou senha incorretos");
  }
  await audit({ action: "auth.login", userId: result.userId, organizationId: result.organizationId, req });
  sendSession(res, 200, result.session);
});

authRouter.post("/refresh", requireClientHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw new AppError(401, "UNAUTHORIZED", "Sem sessão");
  try {
    const session = await auth.refresh(token, client(req));
    sendSession(res, 200, session);
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    if (err instanceof AppError && err.code === "TOKEN_REUSED") {
      await audit({ action: "auth.refresh_reuse_detected", req });
    }
    throw err;
  }
});

authRouter.post("/logout", requireClientHeader, async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

authRouter.post("/forgot-password", authLimiter, validate(forgotSchema), async (req, res) => {
  const { userId } = await auth.requestPasswordReset(req.body.email);
  if (userId) await audit({ action: "auth.password_reset_requested", userId, req });
  res.json({ message: "Se existir uma conta com este email, enviaremos as instruções." });
});

authRouter.post("/reset-password", authLimiter, validate(resetSchema), async (req, res) => {
  const { userId } = await auth.resetPassword(req.body.token, req.body.password);
  await audit({ action: "auth.password_reset", userId, req });
  res.json({ message: "Senha alterada. Faça login com a nova senha." });
});

// ── Rotas autenticadas ──

authRouter.get("/me", requireAuth, async (req, res) => {
  const { userId, organizationId } = authOf(req);
  res.json(await auth.getMe(userId, organizationId));
});

authRouter.patch("/me", requireAuth, validate(updateProfileSchema), async (req, res) => {
  const { userId, organizationId } = authOf(req);
  const user = await auth.updateProfile(userId, req.body);
  await audit({ action: "user.profile_updated", userId, organizationId, req });
  res.json(user);
});

authRouter.post("/change-password", requireAuth, validate(changePasswordSchema), async (req, res) => {
  const { userId, organizationId, sessionId } = authOf(req);
  await auth.changePassword(userId, sessionId, req.body.currentPassword, req.body.newPassword);
  await audit({ action: "auth.password_changed", userId, organizationId, req });
  res.json({ message: "Senha alterada. As outras sessões foram encerradas." });
});

authRouter.get("/sessions", requireAuth, async (req, res) => {
  const { userId, sessionId } = authOf(req);
  const sessions = await auth.listSessions(userId);
  res.json(sessions.map((s) => ({ ...s, current: s.id === sessionId })));
});

authRouter.delete("/sessions/:id", requireAuth, validate(sessionIdParams, "params"), async (req, res) => {
  const { userId, organizationId } = authOf(req);
  const id = req.params.id as string;
  await auth.revokeSession(userId, id);
  await audit({ action: "auth.session_revoked", userId, organizationId, entity: "Session", entityId: id, req });
  res.status(204).end();
});

authRouter.get("/access-history", requireAuth, async (req, res) => {
  res.json(await auth.listAccessHistory(authOf(req).userId));
});
