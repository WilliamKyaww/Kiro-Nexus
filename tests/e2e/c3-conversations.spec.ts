// Slice C3: conversation states (cancel, retry, failure, fallback mode) with the
// deterministic provider double (a labelled fixture, not AI).
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

test.use({ trace: "off", screenshot: "off" }); // a fake key is typed in Settings
const KEY = "nexus-fake-e2e-key-5d1c8a";
const QUESTION = "Which action from the kickoff still has no issue?";
let double: ProviderDouble;
let base: string;
let svc: Service | null = null;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => { base = await tempDir("nexus-c-ask-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

async function workspaceHashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const name of await readdir(d)) {
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (rel.startsWith(".nexus/conversations") || rel === ".nexus/lock") continue;
      if ((await stat(p)).isDirectory()) await walk(p);
      else out[rel] = createHash("sha256").update(await readFile(p)).digest("hex");
    }
  };
  await walk(dir);
  return out;
}

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();

async function addProvider(page: Page, name: string, model: string, expected: RegExp = /Tool calling: Yes/) {
  await nav(page, "Settings");
  const form = page.getByRole("form", { name: "Add a provider" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Base URL").fill(double.baseUrl);
  await form.getByLabel("Model").fill(model);
  await form.getByLabel("API key").fill(KEY);
  await form.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByRole("listitem", { name: `Provider ${name}` })).toContainText(expected);
}

async function askFromHome(page: Page, question: string) {
  await nav(page, "Home");
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: question })).toBeVisible();
}

const lastAnswer = (page: Page) => page.getByRole("article", { name: "Answer" }).last();

test("cancel, retry, a rejected key and the structured-output-only fallback", async ({ page }) => {
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await addProvider(page, "Slow double", "nexus-test-double-slow");
  await askFromHome(page, QUESTION);
  await expect(page.getByRole("status").filter({ hasText: /Asking|Starting|Working/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Cancelled. You cancelled this question.")).toBeVisible();
  const conversationUrl = page.url();

  // Switch to a structured-output-only model and retry the same question.
  await addProvider(page, "Structured double", "nexus-test-double-structured", /Tool calling: No · Structured output: Yes/);
  const card = page.getByRole("listitem", { name: "Provider Structured double" });
  await expect(card).toContainText("Tool calling: No · Structured output: Yes");
  await card.getByRole("button", { name: "Use this provider" }).click();
  await page.goto(conversationUrl);
  await expect(page.getByRole("heading", { level: 1, name: QUESTION })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(lastAnswer(page)).toContainText("has no matching issue");
  await expect(lastAnswer(page)).toContainText("retrieval-first mode");

  // A rejected key fails clearly and points to Settings.
  await nav(page, "Settings");
  const structured = page.getByRole("listitem", { name: "Provider Structured double" });
  await structured.getByRole("button", { name: "Replace key" }).click();
  await structured.getByLabel("API key").fill("invalid-key");
  await structured.getByRole("button", { name: "Save key" }).click();
  await askFromHome(page, QUESTION);
  await expect(page.getByRole("alert")).toContainText("The provider rejected the key");
  await expect(page.getByRole("link", { name: "Check the key in Settings" })).toBeVisible();
});
