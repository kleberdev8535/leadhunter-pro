// PostgreSQL local sem Docker, apenas para desenvolvimento. Dados em apps/api/.pgdata
// Uso: npm run db:local   (Ctrl+C para parar)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const port = Number(process.env.PGPORT ?? 55433);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".pgdata");
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "leadhunter",
  password: "leadhunter_dev",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase("leadhunter");
  await pg.createDatabase("leadhunter_test");
}
console.log(`PostgreSQL local em localhost:${port} (Ctrl+C para parar)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
