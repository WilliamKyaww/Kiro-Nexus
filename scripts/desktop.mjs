// Launch the Electron desktop app.
//   npm run desktop              the try workspace (.tmp/try), isolated desktop profile
//   npm run desktop -- --real    your real profile (%APPDATA%\Nexus) and its last workspace
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot, tryPaths } from "./launcher-lib.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const real = process.argv.includes("--real");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (!real) {
  env.NEXUS_PROFILE_DIR = tryPaths.desktopProfile;
  env.NEXUS_WORKSPACE = tryPaths.workspace;
  env.NEXUS_INIT_SAMPLE = "1";
  console.log(`Desktop app on the try workspace: ${tryPaths.workspace}`);
}
const child = spawn(electronPath, [join(repoRoot, "apps", "desktop", "dist", "main.cjs")], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
