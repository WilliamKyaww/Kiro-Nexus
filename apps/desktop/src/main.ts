// Electron main: starts the local service in a utilityProcess, mints a launch
// code and loads the same web UI in a sandboxed window (architecture 4.2).
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const repoRoot = resolve(__dirname, "..", "..", "..");
const profileDir = resolve(process.env.NEXUS_PROFILE_DIR ?? join(app.getPath("appData"), "Nexus"));
mkdirSync(profileDir, { recursive: true });
app.setPath("userData", join(profileDir, "electron"));

const serviceEntry = process.env.NEXUS_SERVICE_ENTRY ?? join(repoRoot, "server", "dist", "main.mjs");
const controlSecret = randomBytes(32).toString("base64url");
let service: UtilityProcess | null = null;
let servicePort: number | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

function startService(): Promise<number> {
  return new Promise((resolveStart, reject) => {
    const args = ["--profile", profileDir];
    if (process.env.NEXUS_WORKSPACE) args.push("--workspace", process.env.NEXUS_WORKSPACE);
    const child = utilityProcess.fork(serviceEntry, args, {
      stdio: "pipe",
      serviceName: "Nexus local service",
      env: { ...process.env, NEXUS_CONTROL_SECRET: controlSecret },
    });
    service = child;
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[service] ${d}`));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        const msg = JSON.parse(line) as { event?: string; port?: number; code?: string };
        if (msg.event === "ready" && msg.port) resolveStart(msg.port);
        if (msg.event === "error") reject(new Error(`The Nexus service could not start (${msg.code}).`));
      } catch { /* not a control line */ }
    });
    child.once("exit", (code) => {
      service = null;
      if (!quitting) {
        reject(new Error(`The Nexus service stopped (exit ${code}).`));
        if (mainWindow) void dialog.showMessageBox(mainWindow, { type: "error", message: "The Nexus service stopped unexpectedly.", detail: `Exit code ${code}. Restart Nexus to continue; your saved work is on disk.` });
      }
    });
  });
}

async function launchUrl(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/launch-codes`, { method: "POST", headers: { authorization: `Bearer ${controlSecret}` } });
  if (!res.ok) throw new Error(`launch code request failed (${res.status})`);
  const { launchCode } = (await res.json()) as { launchCode: string };
  return `http://127.0.0.1:${port}/#launch=${launchCode}`;
}

async function createWindow(): Promise<void> {
  const port = servicePort ?? (servicePort = await startService());
  const origin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Nexus",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin + "/")) event.preventDefault();
  });
  wc.session.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "notifications"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(await launchUrl(port));
}

ipcMain.on("nexus:app-info", (event) => { event.returnValue = { version: app.getVersion(), platform: process.platform }; });
ipcMain.handle("nexus:pick-workspace-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = win
    ? await dialog.showOpenDialog(win, { title: "Choose a Nexus workspace folder", properties: ["openDirectory", "createDirectory"] })
    : await dialog.showOpenDialog({ title: "Choose a Nexus workspace folder", properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

async function stopService(): Promise<void> {
  const child = service;
  if (!child) return;
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => { child.kill(); resolveStop(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolveStop(); });
    child.postMessage({ type: "shutdown" });
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(createWindow).catch((e: Error) => {
    dialog.showErrorBox("Nexus could not start", e.message);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    void stopService().finally(() => app.quit());
  });
}
