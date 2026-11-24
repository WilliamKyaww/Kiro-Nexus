// Slice C1: provider settings in the browser and in Electron, with the deterministic
// test double (a labelled fixture, not AI). The key is fake.
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { launchUrl, startService, tempDir, type Service } from "./support";

// Traces and screenshots would record the typed key on failure, so they are off here.
test.use({ trace: "off", screenshot: "off" });
const FAKE_KEY = "nexus-fake-e2e-key-5d1c8a";
let double: ProviderDouble;
let base: string;
let svc: Service | null = null;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => { base = await tempDir("nexus-c1-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const p = join(dir, name);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) hits.push(...await filesContaining(p, needle));
    else if (s.size < 50_000_000 && (await readFile(p).catch(() => Buffer.alloc(0))).includes(needle)) hits.push(p);
  }
  return hits;
}

async function addProvider(page: Page, model = "nexus-test-double") {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
  const form = page.getByRole("form", { name: "Add a provider" });
  await form.getByLabel("Name").fill("Local test double");
  await form.getByLabel("Base URL").fill(double.baseUrl);
  await form.getByLabel("Model").fill(model);
  await form.getByLabel("API key").fill(FAKE_KEY);
  await form.getByRole("button", { name: "Add provider" }).click();
}

test("browser: add, test, select and remove a provider; the key stays out of the page's storage", async ({ page }) => {
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await addProvider(page);
  const card = page.getByRole("listitem", { name: "Provider Local test double" });
  await expect(card).toContainText("Tool calling: Yes · Structured output: Yes");
  await expect(card).toContainText("Test double (fixture, not AI)");
  await expect(card).toContainText(`sends excerpts to 127.0.0.1:${double.port}`);
  await expect(card).toContainText("Key kept for this session only");
  await expect(card).toContainText("In use");
  const storage = await page.evaluate(() => JSON.stringify({ s: { ...sessionStorage }, l: { ...localStorage } }));
  expect(storage).not.toContain(FAKE_KEY);
  await expect(page.locator("body")).not.toContainText(FAKE_KEY);

  // A second, structured-output-only profile; select it, then remove it.
  await addProvider(page, "nexus-test-double-structured");
  const cards = page.getByRole("listitem", { name: "Provider Local test double" });
  await expect(cards.nth(1)).toContainText("Tool calling: No · Structured output: Yes");
  await cards.nth(1).getByRole("button", { name: "Use this provider" }).click();
  await expect(cards.nth(1)).toContainText("In use");
  await cards.nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("In use");
  expect(await filesContaining(join(base, "profile"), FAKE_KEY)).toEqual([]);
  expect(await filesContaining(join(base, "ws"), FAKE_KEY)).toEqual([]);
});

test("Electron: the key is encrypted by the OS, survives a relaunch, and never reaches renderer storage", async () => {
  const require = createRequire(import.meta.url);
  const electronPath = require("electron") as string;
  const profile = join(base, "profile");
  const ws = join(base, "ws");
  await mkdir(ws);
  const env = { ...process.env, NEXUS_PROFILE_DIR: profile, NEXUS_WORKSPACE: ws } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ executablePath: electronPath, args: [resolve("apps/desktop/dist/main.cjs")], env, timeout: 60_000 });

  let app = await launch();
  let win = await app.firstWindow();
  await expect(win.getByRole("heading", { name: "What do you need?" })).toBeVisible({ timeout: 30_000 });
  await addProvider(win);
  let card = win.getByRole("listitem", { name: "Provider Local test double" });
  await expect(card).toContainText("Key saved, protected by Windows");
  await expect(card).toContainText("Tool calling: Yes");
  const secrets = await readFile(join(profile, "secrets.bin"), "utf8");
  expect(secrets).not.toContain(FAKE_KEY);
  expect(Object.keys(JSON.parse(secrets).keys)).toHaveLength(1);
  expect(await win.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(FAKE_KEY);
  await app.close();

  app = await launch();
  win = await app.firstWindow();
  await win.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
  card = win.getByRole("listitem", { name: "Provider Local test double" });
  await expect(card).toContainText("Key saved, protected by Windows");
  await card.getByRole("button", { name: "Test" }).click();
  await expect(win.getByText(/Tested Local test double: tool calling yes/)).toBeVisible();
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card).toHaveCount(0);
  await app.close();
  expect(JSON.parse(await readFile(join(profile, "secrets.bin"), "utf8")).keys).toEqual({});
  expect(await filesContaining(profile, FAKE_KEY)).toEqual([]);
  expect(await filesContaining(ws, FAKE_KEY)).toEqual([]);
});
