// B1 Electron smoke: secure window, same UI, note persists across quit and relaunch, lock released.
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { tempDir } from "./support";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const mainEntry = resolve("apps/desktop/dist/main.cjs");

let base: string;
test.beforeEach(async () => { base = await tempDir("nexus-electron-"); });
test.afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function launch(profile: string, workspace: string): Promise<ElectronApplication> {
  const env = { ...process.env, NEXUS_PROFILE_DIR: profile, NEXUS_WORKSPACE: workspace } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ executablePath: electronPath, args: [mainEntry], env, timeout: 60_000 });
}

test("desktop window is sandboxed, shows the same UI and keeps a note across relaunch", async () => {
  const profile = join(base, "profile");
  const ws = join(base, "workspace");
  await mkdir(ws);

  let app = await launch(profile, ws);
  let win = await app.firstWindow();
  await expect(win.getByRole("heading", { name: "What do you need?" })).toBeVisible({ timeout: 30_000 });
  expect(win.url()).not.toContain("launch=");

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // Present at runtime but missing from Electron 45's type definitions.
    type Prefs = { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean; webSecurity?: boolean };
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Prefs | null };
    const p = wc.getLastWebPreferences();
    return { sandbox: p?.sandbox, contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration, webSecurity: p?.webSecurity };
  });
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
  expect(await win.evaluate(() => Object.keys(window.nexusNative ?? {}).sort())).toEqual(["appInfo", "deleteProviderKey", "keyStorage", "pickWorkspaceFolder", "setProviderKey"]);

  await win.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Notes" }).click();
  await win.getByRole("textbox", { name: "Title" }).fill("Desktop note");
  await win.getByRole("button", { name: "Create note" }).click();
  await win.getByRole("textbox", { name: /Markdown for Desktop note\.md/ }).fill("# Desktop note\n\n## Agenda\n\nWritten in Electron.\n");
  await win.getByRole("button", { name: "Save" }).click();
  await expect(win.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readdir(join(ws, ".nexus"))).toContain("lock");

  await app.close();
  expect(await readdir(join(ws, ".nexus"))).not.toContain("lock");
  expect(await readFile(join(ws, "Desktop note.md"), "utf8")).toBe("# Desktop note\n\n## Agenda\n\nWritten in Electron.\n");

  app = await launch(profile, ws);
  win = await app.firstWindow();
  await win.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Notes" }).click();
  await win.getByRole("link", { name: "Desktop note" }).click();
  await expect(win.getByText("Written in Electron.")).toBeVisible();
  await app.close();
});

test("desktop app refuses a workspace the browser service already holds, and says why", async () => {
  const { startService } = await import("./support");
  const ws = join(base, "workspace");
  await mkdir(ws);
  const browserService = await startService(join(base, "browser-profile"), ws);
  try {
    const lockBefore = await readFile(join(ws, ".nexus", "lock"), "utf8");
    const app = await launch(join(base, "desktop-profile"), ws);
    const win = await app.firstWindow();
    await expect(win.getByRole("heading", { name: "Workspace" })).toBeVisible({ timeout: 30_000 });
    await expect(win.getByRole("alert")).toContainText(`open in another Nexus instance (pid ${browserService.child.pid}, port ${browserService.port})`);
    await app.close();
    expect(await readFile(join(ws, ".nexus", "lock"), "utf8")).toBe(lockBefore);
  } finally {
    await browserService.stop();
  }
});
