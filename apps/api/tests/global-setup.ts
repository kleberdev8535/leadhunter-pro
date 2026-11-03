import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Aplica as migrações no banco de teste antes da suíte. Requer `npm run db:local` (ou Docker) rodando. */
export default function setup() {
  const env = config({ path: ".env.test", override: true, quiet: true }).parsed ?? {};
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, ...env } });
}
