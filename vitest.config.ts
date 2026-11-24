import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nexus/schema": here("./packages/schema/src/index.ts"),
      "@nexus/markdown": here("./packages/markdown/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "server/src/**/*.test.ts"],
    globalSetup: ["./server/test/global-setup.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
