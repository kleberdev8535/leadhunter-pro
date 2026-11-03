import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "../lib/errors.js";

type Part = "body" | "query" | "params";

/** Valida e substitui a parte da requisição pelo valor já transformado pelo Zod. */
export function validate<T>(schema: ZodType<T>, part: Part = "body"): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return next(badRequest("Dados inválidos", details));
    }
    if (part === "query") Object.defineProperty(req, "query", { value: result.data, writable: true });
    else (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
}
