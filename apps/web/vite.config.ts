/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Pré-empacota dependências pesadas na inicialização, evitando recarregar a página na 1ª visita.
  optimizeDeps: { include: ["phaser", "socket.io-client", "recharts", "motion/react", "radix-ui", "lucide-react", "sonner"] },
  server: {
    port: Number(process.env.WEB_PORT ?? 5210),
    strictPort: true,
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:8110", changeOrigin: false, ws: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    css: false,
    testTimeout: 20_000,
  },
});
