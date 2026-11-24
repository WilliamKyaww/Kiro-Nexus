// Slice C4: proof of grounded read-only Ask, end to end, with the deterministic provider
// double (a labelled fixture, not AI), in two different fictional workspaces.
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

test("the kickoff question is answered from both sources, citations open and return, and Ask changes nothing", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  await page.goto(await launchUrl(svc));

  // AI off: the composer is disabled, explains why, and Home still offers notes.
  await expect(page.getByText("AI is off", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask about your notes and projects" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Open the kickoff meeting note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeDisabled();

  await addProvider(page, "Local test double", "nexus-test-double");
  await nav(page, "Home");
  await expect(page.getByTestId("model-chip")).toHaveText(`Model: nexus-test-double via 127.0.0.1:${double.port} (test double)`);
  await expect(page.getByText(`Ask sends excerpts of the notes and issues it reads to 127.0.0.1:${double.port}.`)).toBeVisible();

  const before = await workspaceHashes(ws);
  await askFromHome(page, QUESTION);
  const answer = lastAnswer(page);
  await expect(answer).toContainText("Answer from the local test double: a fixed, rule-based fixture, not AI.");
  const facts = answer.getByRole("region", { name: "Recorded facts" });
  await expect(facts).toContainText("“Will writes the judge instructions” has no matching issue.");
  await expect(facts).toContainText("“Hein builds the calendar view” is tracked by NEX-1");
  await expect(answer.getByRole("region", { name: "Suggestions (not established facts)" })).toContainText("Create an issue for “Will writes the judge instructions”.");
  await expect(answer).toContainText("Consulted:");
  expect(await workspaceHashes(ws)).toEqual(before);

  // Citations open the exact heading and the issue, and lead back.
  await facts.getByRole("link", { name: "Kickoff, 24 November 2026 › Actions" }).first().click();
  await expect(page.locator(".heading-target")).toContainText("Actions");
  await page.getByRole("link", { name: "← Back to conversation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: QUESTION })).toBeVisible();
  await facts.getByRole("link", { name: "NEX-1 Build calendar view" }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to conversation" }).click();
  const conversationUrl = page.url();

  // Create the missing issue by hand, then ask again in the same conversation.
  await nav(page, "Projects");
  await page.getByRole("link", { name: /NEX Nexus hackathon/ }).click();
  await page.getByRole("textbox", { name: "New issue" }).fill("Write the judge instructions");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: "NEX-2 Write the judge instructions" })).toBeVisible();
  const afterManual = await workspaceHashes(ws);
  await page.goto(conversationUrl);
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(QUESTION);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(2);
  const second = lastAnswer(page).getByRole("region", { name: "Recorded facts" });
  await expect(second).toContainText("“Will writes the judge instructions” is tracked by NEX-2");
  await expect(second).not.toContainText("has no matching issue");
  expect(await workspaceHashes(ws)).toEqual(afterManual);

  // The conversation is saved in the workspace and survives a restart.
  const files = await readdir(join(ws, ".nexus", "conversations"));
  expect(files).toHaveLength(1);
  await svc.stop();
  svc = await startService(join(base, "profile"));
  await page.goto(await launchUrl(svc));
  await expect(page.getByRole("link", { name: QUESTION })).toBeVisible();
  await page.getByRole("link", { name: QUESTION }).click();
  await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(2);
});

test("an absence claim made without reading every issue is shown as not confirmed", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  const api = await apiSession(svc);
  const project = (await api("GET", "/projects")).body.projects[0];
  for (let i = 2; i <= 50; i++) await api("POST", "/issues", { projectId: project.id, title: `Fictional filler task ${String(i).padStart(2, "0")}` });
  await api("POST", "/issues", { projectId: project.id, title: "Write the judge instructions" }); // NEX-51
  await page.goto(await launchUrl(svc));
  await addProvider(page, "Local test double (reads one page)", "nexus-test-double-lazy");
  await askFromHome(page, QUESTION);
  const answer = lastAnswer(page);
  await expect(answer.getByRole("region", { name: "Recorded facts" })).not.toContainText("has no matching issue");
  const unconfirmed = answer.getByRole("region", { name: "Not confirmed (Nexus did not read every record)" });
  await expect(unconfirmed).toContainText("“Will writes the judge instructions” has no matching issue.");
  await expect(unconfirmed).toContainText("Not confirmed: Nexus read 50 of 51 issues in this run, so a matching issue may exist.");
  await expect(answer).toContainText("Scope limited: only 50 of 51 issues were read.");
});

test("a second fictional workspace gets answers from its own names and keys", async ({ page }) => {
  const ws = join(base, "planning");
  await mkdir(join(ws, "standups"), { recursive: true });
  await writeFile(join(ws, "standups", "2026-11-20 planning.md"),
    "# Planning, 20 November 2026\n\nFictional sample data.\n\n## Action items\n\n- [ ] Priya drafts the onboarding guide\n- [ ] Tomasz migrates the billing tests\n");
  svc = await startService(join(base, "profile"), ws);
  const api = await apiSession(svc);
  const project = (await api("POST", "/projects", { key: "OPS", name: "Operations" })).body;
  await api("POST", "/issues", { projectId: project.id, title: "Migrate the billing tests" });
  await page.goto(await launchUrl(svc));
  await addProvider(page, "Local test double", "nexus-test-double");
  const before = await workspaceHashes(ws);
  await askFromHome(page, "Which action from the planning meeting still has no issue?");
  const facts = lastAnswer(page).getByRole("region", { name: "Recorded facts" });
  await expect(facts).toContainText("“Priya drafts the onboarding guide” has no matching issue.");
  await expect(facts).toContainText("“Tomasz migrates the billing tests” is tracked by OPS-1");
  await expect(lastAnswer(page)).not.toContainText(/NEX-|judge|calendar/);
  await facts.getByRole("link", { name: "Planning, 20 November 2026 › Action items" }).first().click();
  await expect(page.locator(".heading-target")).toContainText("Action items");
  expect(await workspaceHashes(ws)).toEqual(before);
});
