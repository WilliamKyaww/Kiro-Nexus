// Builds the web UI (Vite) and the Node bundles (esbuild): service, Electron main and preload.
import { build as viteBuild } from "vite";
import { fileURLToPath } from "node:url";
import { buildDesktop, buildServer } from "./bundles.mjs";

const started = Date.now();
await viteBuild({ configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)), logLevel: "warn" });
await buildServer();
await buildDesktop();
console.log(`Build complete in ${((Date.now() - started) / 1000).toFixed(1)} s`);
