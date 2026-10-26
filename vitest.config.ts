import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js handles "server-only" itself; in tests it is just an empty module.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup.ts"],
    // Integration tests share one database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
