import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

const message = { error: { code: "TOO_MANY_REQUESTS", message: "Muitas requisições. Aguarde um pouco." } };

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message,
  skip: () => env.isTest,
});

/** Limite por IP nas rotas sensíveis; o bloqueio por conta fica no serviço de login. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 1000 : 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Muitas tentativas. Tente novamente em alguns minutos." } },
});
