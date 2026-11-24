// Nexus local service entry point.
//   node server/dist/main.mjs --profile <dir> [--workspace <dir>] [--port <n>]
// Prints one JSON ready line to stdout (port and pid only); logs go to stderr.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { copySampleWorkspace } from "./workspace/service";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { resolveProfileDir, removeServiceFile, writeServiceFile, readRecent } from "./profile";
import { SessionManager } from "./security/session";
import { AppState } from "./state";
import { extraPlugins, extraStartup } from "./plugins";
import { handleParentMessage } from "./providers";
import { setNativeStatus } from "./scheduler";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const profileDir = resolveProfileDir(arg("profile"));
const webDist = resolve(arg("web-dist") ?? process.env.NEXUS_WEB_DIST ?? join(repoRoot, "apps", "web", "dist"));
const sampleDir = resolve(arg("sample-dir") ?? process.env.NEXUS_SAMPLE_DIR ?? join(repoRoot, "samples", "meeting-workspace"));
const requestedPort = Number(arg("port") ?? process.env.NEXUS_PORT ?? 0);
const instanceId = randomUUID();

mkdirSync(join(profileDir, "logs"), { recursive: true });
const logFile = join(profileDir, "logs", "service.log");
const log = (line: string) => {
  const entry = `${new Date().toISOString()} ${line}`;
  process.stderr.write(entry + "\n");
  try { appendFileSync(logFile, entry + "\n"); } catch { /* logging must never crash the service */ }
};

const secretFromParent = process.env.NEXUS_CONTROL_SECRET;
delete process.env.NEXUS_CONTROL_SECRET;
const sessions = new SessionManager(secretFromParent && secretFromParent.length >= 32 ? secretFromParent : undefined);
const state = new AppState(profileDir, instanceId, null, log);

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("service: shutting down");
  try {
    await state.closeWorkspace();
    await app.close();
    await removeServiceFile(profileDir, instanceId);
  } finally {
    process.exit(code);
  }
}

const app = createApp({ state, sessions, webDist, sampleDir, onShutdownRequest: () => void shutdown(0), plugins: extraPlugins(state) });

try {
  await extraStartup(state);
  await app.listen({ host: "127.0.0.1", port: requestedPort });
} catch (e) {
  log(`service: could not listen on port ${requestedPort}: ${(e as Error).message}`);
  process.stdout.write(JSON.stringify({ event: "error", code: (e as NodeJS.ErrnoException).code ?? "LISTEN_FAILED" }) + "\n");
  process.exit(2);
}
const address = app.server.address();
const port = typeof address === "object" && address ? address.port : requestedPort;
state.port = port;
await writeServiceFile(profileDir, { pid: process.pid, port, instanceId, controlSecret: sessions.controlSecret, startedAt: new Date().toISOString() });
log(`service: listening on 127.0.0.1:${port}, profile ${profileDir}`);

const startupWorkspace = arg("workspace") ?? (await readRecent(profileDir))[0]?.path;
const initSample = process.argv.includes("--init-sample") || process.env.NEXUS_INIT_SAMPLE === "1";
if (startupWorkspace && initSample && !existsSync(startupWorkspace)) {
  await copySampleWorkspace(sampleDir, startupWorkspace);
  log("workspace: created from the fictional sample");
}
if (startupWorkspace) {
  await state.open(startupWorkspace).catch((e) => log(`workspace: could not open at start-up: ${(e as Error).message}`));
}

process.stdout.write(JSON.stringify({ event: "ready", port, pid: process.pid }) + "\n");

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
// Closing the console window (for example "Start Nexus.bat") sends SIGHUP on Windows, which
// otherwise ends the process at once and leaves the workspace lock behind.
process.on("SIGHUP", () => void shutdown(0));
process.on("message", (m: unknown) => { if ((m as { type?: string })?.type === "shutdown") void shutdown(0); });
// Electron utilityProcess channel.
const parentPort = (process as unknown as { parentPort?: { on: (e: string, cb: (m: { data: unknown }) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
parentPort?.on("message", (m) => {
  const data = m.data as { type?: string; available?: unknown; reason?: unknown };
  if (data?.type === "shutdown") void shutdown(0);
  else if (data?.type === "native-notifications") setNativeStatus(state, { available: data.available === true, reason: typeof data.reason === "string" ? data.reason.slice(0, 200) : null });
  else handleParentMessage(state, m.data);
});
// B4: every delivered reminder also goes to Electron main, which shows the native notification.
// It is the same delivery record the browser shows; main only adds a surface.
if (parentPort) {
  state.bus.on("event", (e: { type: string; delivery?: unknown; native?: unknown }) => {
    if (e.type === "notification") parentPort.postMessage({ type: "notification", delivery: e.delivery, native: e.native !== false });
  });
}
