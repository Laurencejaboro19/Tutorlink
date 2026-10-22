import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "src/__tests__/empty.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    fileParallelism: false,
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
