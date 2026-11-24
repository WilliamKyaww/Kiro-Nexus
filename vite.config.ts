import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./apps/web"),
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@nexus/schema": here("./packages/schema/src/index.ts"),
      "@nexus/markdown": here("./packages/markdown/src/index.ts"),
    },
  },
  build: {
    outDir: here("./apps/web/dist"),
    emptyOutDir: true,
    sourcemap: true,
    // One local bundle served from loopback; splitting buys nothing yet.
    chunkSizeWarningLimit: 1200,
    // No inline scripts or modulepreload polyfill, so a strict CSP holds.
    modulePreload: { polyfill: false },
  },
});
