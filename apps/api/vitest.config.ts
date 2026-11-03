import { defineConfig } from "vitest/config";
import { config } from "dotenv";

const testEnv = config({ path: ".env.test", override: true, quiet: true }).parsed ?? {};

export default defineConfig({
  test: {
    environment: "node",
    env: testEnv,
    globalSetup: ["tests/global-setup.ts"],
    // Os testes de integração compartilham o mesmo banco de teste.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
