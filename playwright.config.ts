import { defineConfig, devices } from "@playwright/test";

// E2E sobe uma API própria (porta 8111) apontando para o banco de teste e um Vite (5211) com proxy para ela.
// Pré-requisito: `npm run db:local` rodando (ou Docker com Postgres na 55433).
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 2,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // Primeira carga de cada página no Vite dev compila sob demanda; com vários navegadores em paralelo leva alguns segundos.
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5211", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "npx prisma migrate deploy && npx tsx --env-file=.env.test src/server.ts",
      cwd: "apps/api",
      env: { PORT: "8111", DATABASE_URL: "postgresql://leadhunter:leadhunter_dev@localhost:55433/leadhunter_test" },
      url: "http://localhost:8111/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx vite",
      cwd: "apps/web",
      env: { WEB_PORT: "5211", API_PROXY_TARGET: "http://localhost:8111" },
      url: "http://localhost:5211",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
