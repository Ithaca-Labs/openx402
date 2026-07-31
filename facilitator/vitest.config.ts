import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests exercise the workspace package from source; `npm run build`
      // still emits the published dist entry point.
      "@openx402/bazaar-sdk": fileURLToPath(new URL("./packages/bazaar-sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integration suites share one PostgreSQL database and truncate between
    // tests, so files must not run concurrently.
    fileParallelism: false,
    // Live model tests download real weights; they are opt-in via
    // `npm run test:live-model`.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/live-model/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
