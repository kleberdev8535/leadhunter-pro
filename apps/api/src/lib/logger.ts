import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.isTest ? "silent" : env.isProd ? "info" : "debug",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.apiKey", "*.token"],
    censor: "[redacted]",
  },
  ...(env.isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
