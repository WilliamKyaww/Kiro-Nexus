// Start the Nexus service and open the browser.
//   node scripts/launch.mjs            real profile (%APPDATA%\Nexus), opens the last workspace
//   node scripts/launch.mjs --try      disposable copy of the fictional sample in .tmp/try (port 47100)
//   node scripts/launch.mjs --reset-try  delete .tmp/try
// Options: --workspace <dir> --profile <dir> --port <n> --no-open
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { TRY_PORT, arg, defaultProfile, isAlive, launchUrl, openInBrowser, readServiceFile, repoRoot, tryPaths, tryRoot } from "./launcher-lib.mjs";

if (process.argv.includes("--reset-try")) {
  for (const p of [tryPaths.profile, tryPaths.desktopProfile]) {
    const info = await readServiceFile(p);
    if (info && isAlive(info.pid)) {
      console.error("Nexus is still running on the try workspace. Close it first (Ctrl+C in its terminal, or close the desktop window).");
      process.exit(1);
    }
  }
  await rm(tryRoot, { recursive: true, force: true });
  console.log(`Removed ${tryRoot}. The next "npm run try" starts from a fresh copy of the sample.`);
  process.exit(0);
}

const tryMode = process.argv.includes("--try");
const profile = tryMode ? tryPaths.profile : (arg("profile") ?? defaultProfile());
const workspace = tryMode ? tryPaths.workspace : arg("workspace");
const port = tryMode ? TRY_PORT : Number(arg("port") ?? 0);

const existing = await readServiceFile(profile);
if (existing && isAlive(existing.pid)) {
  const url = await launchUrl(profile);
  if (url) {
    console.log(`Nexus is already running (pid ${existing.pid}). Opening a new session.`);
    if (!process.argv.includes("--no-open")) openInBrowser(url);
    process.exit(0);
  }
}

const args = [join(repoRoot, "server", "dist", "main.mjs"), "--profile", profile, "--port", String(port)];
if (workspace) args.push("--workspace", workspace);
if (tryMode) args.push("--init-sample");
const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });

createInterface({ input: child.stdout }).on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.event === "error") {
    console.error(msg.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Another Nexus may be running: try "npm run open", or close it first.`
      : `The Nexus service could not start (${msg.code}).`);
    return;
  }
  if (msg.event !== "ready") return;
  const url = await launchUrl(profile);
  console.log("");
  console.log(`Nexus is running at http://127.0.0.1:${msg.port}/`);
  if (tryMode) console.log(`Workspace (disposable copy of the fictional sample): ${tryPaths.workspace}`);
  console.log(`Profile: ${profile}`);
  console.log(`New browser session: npm run open${tryMode ? " -- --try" : ""}`);
  console.log("Stop: press Ctrl+C here.");
  if (url && !process.argv.includes("--no-open")) openInBrowser(url);
  else if (url) console.log(`Launch link (single use, valid for 2 minutes): ${url}`);
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => { /* the service receives Ctrl+C too and shuts down cleanly */ });
