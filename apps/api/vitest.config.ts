import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Os testes de integração partilham a mesma BD de teste.
    threads: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
