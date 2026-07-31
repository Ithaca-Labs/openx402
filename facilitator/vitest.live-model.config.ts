import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Live local-model tests. These download real ONNX weights, so they are opt-in
 * (`npm run test:live-model`) and are excluded from the default suite.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@openx402/bazaar-sdk": fileURLToPath(new URL("./packages/bazaar-sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live-model/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
