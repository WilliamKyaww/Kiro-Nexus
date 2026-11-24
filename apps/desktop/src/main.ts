// Electron main: starts the local service in a utilityProcess, mints a launch
// code and loads the same web UI in a sandboxed window (architecture 4.2).
import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
      env: { ...process.env, NEXUS_CONTROL_SECRET: controlSecret, NEXUS_DESKTOP: "1" },
    });
    service = child;
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[service] ${d}`));
    child.on("message", (m: unknown) => {
      const msg = m as { type?: string; delivery?: NativeDelivery; native?: boolean };
      if (msg?.type === "notification" && msg.delivery) showNativeNotification(msg.delivery, msg.native !== false);
    });
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        const msg = JSON.parse(line) as { event?: string; port?: number; code?: string };
        if (msg.event === "ready" && msg.port) { sendStoredKeys(child); child.postMessage({ type: "native-notifications", ...nativeStatus() }); resolveStart(msg.port); }
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

// ---------- Provider keys (PRD-076): encrypted with safeStorage (DPAPI on Windows) ----------
const secretsFile = join(profileDir, "secrets.bin");
type Secrets = { version: 1; keys: Record<string, string> };
function readSecrets(): Secrets {
  try {
    const data = JSON.parse(readFileSync(secretsFile, "utf8")) as Secrets;
    return data?.version === 1 && data.keys && typeof data.keys === "object" ? data : { version: 1, keys: {} };
  } catch {
    return { version: 1, keys: {} };
  }
}
function writeSecrets(s: Secrets): void {
  const tmp = `${secretsFile}.tmp-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  renameSync(tmp, secretsFile);
}
const encryptionAvailable = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
function sendStoredKeys(child: UtilityProcess): void {
  if (!encryptionAvailable()) return;
  for (const [profileId, b64] of Object.entries(readSecrets().keys)) {
    try {
      child.postMessage({ type: "provider-key", profileId, key: safeStorage.decryptString(Buffer.from(b64, "base64")), storage: "os-protected" });
    } catch { /* unreadable on this machine or user: skip */ }
  }
}
const fromAppOrigin = (event: IpcMainInvokeEvent) => servicePort !== null && (event.senderFrame?.url ?? "").startsWith(`http://127.0.0.1:${servicePort}/`);
const validId = (v: unknown): v is string => typeof v === "string" && /^prf_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);

ipcMain.handle("nexus:key-storage", () => (encryptionAvailable() ? "os-protected" : "session"));
ipcMain.handle("nexus:set-provider-key", (event, profileId: unknown, key: unknown) => {
  if (!fromAppOrigin(event) || !validId(profileId) || typeof key !== "string" || !key.trim() || key.length > 500) throw new Error("Invalid key request.");
  const storage = encryptionAvailable() ? "os-protected" : "session";
  if (storage === "os-protected") {
    const s = readSecrets();
    s.keys[profileId] = safeStorage.encryptString(key.trim()).toString("base64");
    writeSecrets(s);
  }
  service?.postMessage({ type: "provider-key", profileId, key: key.trim(), storage });
  return storage;
});
ipcMain.handle("nexus:delete-provider-key", (event, profileId: unknown) => {
  if (!fromAppOrigin(event) || !validId(profileId)) throw new Error("Invalid key request.");
  const s = readSecrets();
  delete s.keys[profileId];
  writeSecrets(s);
  service?.postMessage({ type: "provider-key-delete", profileId });
  return true;
});

// ---------- Reminders (B4, PRD-043): the native surface for the service's delivery record ----------
interface NativeDelivery { id: string; kind: string; title: string; detail: string; targetKey: string | null; workspaceId: string }
const notifyLog = process.env.NEXUS_E2E_NOTIFY_LOG ?? null;

/**
 * Whether native notifications can be shown. Windows grants them without a prompt, but they
 * can be unsupported. NEXUS_NATIVE_NOTIFICATIONS=denied simulates a denial for tests.
 */
function nativeStatus(): { available: boolean; reason: string | null } {
  if (process.env.NEXUS_NATIVE_NOTIFICATIONS === "denied") return { available: false, reason: "notifications are not allowed for Nexus (simulated for a test)." };
  if (!Notification.isSupported()) return { available: false, reason: "this system does not support desktop notifications." };
  return { available: true, reason: null };
}

const validDelivery = (d: NativeDelivery) => /^dlv_[0-9A-HJKMNP-TV-Z]{26}$/.test(d.id) && /^wsp_[0-9A-HJKMNP-TV-Z]{26}$/.test(d.workspaceId);
const reminderPath = (d: NativeDelivery) => `/notifications/open?id=${encodeURIComponent(d.id)}&ws=${encodeURIComponent(d.workspaceId)}`;
const shown = new Map<string, NativeDelivery>();

/** A click (real, or simulated by a test) focuses the window and opens the reminder's item. */
function openReminder(id: string): void {
  const d = shown.get(id);
  if (!d || !mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("nexus:navigate", reminderPath(d));
}

function showNativeNotification(d: NativeDelivery, enabled: boolean): void {
  if (!enabled || !validDelivery(d) || !nativeStatus().available) return; // the in-app route still shows it
  shown.set(d.id, d);
  const title = d.kind === "test" ? "Test reminder" : `Reminder${d.targetKey && d.kind === "issue" ? `: ${d.targetKey}` : ""}`;
  const body = d.kind === "test" ? d.detail : `${d.title}. ${d.detail}`;
  if (notifyLog) {
    // Tests record the notification instead of showing an operating-system toast.
    appendFileSync(notifyLog, JSON.stringify({ id: d.id, title, body, at: new Date().toISOString() }) + "\n");
    return;
  }
  const n = new Notification({ title, body: body.slice(0, 250) });
  n.on("click", () => openReminder(d.id));
  n.show();
}
// For tests: simulate the operating system's click on a native notification.
(app as unknown as NodeJS.EventEmitter).on("nexus:test-notification-click", (id: string) => openReminder(id));

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
