import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // packages/shared é importado directamente a partir do código-fonte (CLAUDE.md §4).
      "@cf/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  build: {
    // O exceljs (~940 kB) só é descarregado ao exportar para Excel (import dinâmico); não entra no bundle inicial.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
