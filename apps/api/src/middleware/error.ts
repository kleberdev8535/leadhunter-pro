import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // JSON malformado vindo do express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "JSON inválido" } });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Requisição muito grande" } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "erro não tratado");
  res.status(500).json({ error: { code: "INTERNAL", message: "Erro interno. Tente novamente." } });
};
