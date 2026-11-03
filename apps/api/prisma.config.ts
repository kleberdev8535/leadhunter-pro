import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` não acessa o banco (roda em builds sem DATABASE_URL, como o do site estático);
// `migrate` usa sempre a URL real definida no ambiente.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL || "postgresql://build:build@localhost:5432/build" },
});
