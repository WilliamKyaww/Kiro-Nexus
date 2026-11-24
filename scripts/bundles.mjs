// esbuild bundles for the Node side. Shared by build.mjs and the test global setup.
import { build as esbuild } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  "@nexus/schema": here("../packages/schema/src/index.ts"),
  "@nexus/markdown": here("../packages/markdown/src/index.ts"),
};

export async function buildServer() {
  await esbuild({
    entryPoints: [here("../server/src/main.ts")],
    outfile: here("../server/dist/main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: true,
    alias,
    // CommonJS dependencies inside an ESM bundle need require().
    banner: { js: "import { createRequire as __nexusCreateRequire } from 'node:module'; const require = __nexusCreateRequire(import.meta.url);" },
    logLevel: "warning",
  });
}

export async function buildDesktop() {
  await esbuild({
    entryPoints: { main: here("../apps/desktop/src/main.ts"), preload: here("../apps/desktop/src/preload.ts") },
    outdir: here("../apps/desktop/dist"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    sourcemap: true,
    alias,
    logLevel: "warning",
  });
}
