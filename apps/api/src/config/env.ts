import { z } from "zod";

/** "app.onrender.com" → "https://app.onrender.com" (o Render injeta só o host entre serviços). */
const withProtocol = (v: unknown) =>
  typeof v === "string"
    ? v.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (/^https?:\/\//.test(s) ? s : `https://${s}`)).join(",")
    : v;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).default(8110),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.preprocess(withProtocol, z.string().default("http://localhost:5210")),
  APP_URL: z.preprocess(withProtocol, z.string().url().default("http://localhost:5210")),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET precisa de pelo menos 32 caracteres"),
  // 32 bytes em base64 (usado direto) ou qualquer segredo com 32+ caracteres (derivado por SHA-256).
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY precisa de pelo menos 32 caracteres"),
  REDIS_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("LeadHunter Pro <no-reply@localhost>"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};
