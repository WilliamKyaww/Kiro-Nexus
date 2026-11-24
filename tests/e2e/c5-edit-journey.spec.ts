// Run 4, milestone 5: the first Ask → Edit → Review journey (one J7 slice), end to end, with
// the deterministic provider double (a labelled fixture, not AI). Real files, typed operations
// through the review journal, per-change decisions, dependencies and a restart while pending.
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

test.use({ trace: "off", screenshot: "off" }); // a fake key is typed in Settings
const KEY = "nexus-fake-e2e-edit-key-91f3";
const NOTE = "meetings/2026-11-24 kickoff.md";
const QUESTION = "Which action from the kickoff still has no issue?";
const EDIT = "Create the missing issue, link it to its source heading and update the note line.";
const LABEL = "Edit by nexus-test-double (test double, not AI)";
let double: ProviderDouble;
let base: string;
let svc: Service | null = null;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => { base = await tempDir("nexus-c5-edit-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

const noteText = (ws: string) => readFile(join(ws, ...NOTE.split("/")), "utf8");
const issues = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<{ key: string; title: string; noteLinks: Array<{ headingSlug: string | null }> }>;
const journalStates = async (ws: string) => {
  const dir = join(ws, ".nexus", "reviews");
  const runs = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
  return runs.flatMap((r: { source: { label: string }; changes: Array<{ kind: string; state: string }> }) => r.changes.map((c) => `${r.source.label}: ${c.kind} ${c.state}`)).sort();
};
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
const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });
const lastAnswer = (page: Page) => page.getByRole("article", { name: "Answer" }).last();

async function setUp(page: Page): Promise<{ ws: string; profile: string }> {
  const ws = join(base, "ws");
  const profile = join(base, "profile");
  svc = await startService(profile, ws, ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await nav(page, "Settings");
  const form = page.getByRole("form", { name: "Add a provider" });
  await form.getByLabel("Name").fill("Local test double");
  await form.getByLabel("Base URL").fill(double.baseUrl);
  await form.getByLabel("Model").fill("nexus-test-double");
  await form.getByLabel("API key").fill(KEY);
  await form.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByRole("listitem", { name: "Provider Local test double" })).toContainText(/Tool calling: Yes/);
  // The grounded kickoff answer comes first, in Ask mode.
  await nav(page, "Home");
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(QUESTION);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(lastAnswer(page).getByRole("region", { name: "Recorded facts" })).toContainText("“Will writes the judge instructions” has no matching issue.");
  return { ws, profile };
}

/** The user explicitly switches to Edit and asks for the changes. */
async function askForEdit(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Edit proposes changes to your notes and issues.")).toBeVisible();
  await page.getByRole("textbox", { name: "Describe the changes for Nexus to propose" }).fill(EDIT);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("Edit proposes the missing issue, its heading link and the note line; each opens highlighted and is accepted with what it needs", async ({ page }) => {
  const { ws } = await setUp(page);
  const conversationUrl = page.url();
  await askForEdit(page);

  // The first change opens by itself: the note line, highlighted, with the fixture's label.
  const block = page.locator(".pending-block");
  await expect(block).toContainText("Will writes the judge instructions (NEX-2)");
  await expect(block).toBeFocused();
  await expect(bar(page)).toContainText(LABEL);
  await expect(bar(page)).toContainText("Change 1 of 3");
  expect(await noteText(ws)).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
  const nex2 = (await issues(ws)).find((i) => i.key === "NEX-2");
  expect(nex2?.title).toBe("Write the judge instructions");
  expect(nex2?.noteLinks).toEqual([expect.objectContaining({ notePath: NOTE, headingSlug: "actions", headingText: "Actions" })]);

  // The note line needs the new issue: Nexus asks before accepting both.
  await bar(page).getByRole("button", { name: "Accept", exact: true }).click();
  const confirm = page.getByRole("group", { name: "Accept related changes" });
  await expect(confirm).toContainText("New issue NEX-2: Write the judge instructions");
  await expect(confirm.getByRole("button", { name: "Accept both" })).toBeFocused();
  await confirm.getByRole("button", { name: "Accept both" }).click();
  await expect(bar(page)).toContainText("with the change it is tied to");

  // The bar moves on to the link, highlighted on the new issue's page.
  await expect(page.getByRole("heading", { name: "NEX-2 Write the judge instructions" })).toBeVisible();
  const link = page.locator(".links li.pending-field");
  await expect(link).toContainText("Actions");
  await expect(link).toContainText("Pending review");
  await expect(link).toBeFocused();
  await expect(page.getByText("New link to meetings/2026-11-24 kickoff › Actions")).toBeVisible();
  await page.getByRole("button", { name: "Accept new link" }).click();
  await expect(bar(page)).toContainText("All changes reviewed.");
  expect(await journalStates(ws)).toEqual([`${LABEL}: note.replaceSpan accepted`, `${LABEL}: record.addLink accepted`, `${LABEL}: record.create accepted`]);

  // The conversation shows the proposals and their outcome; the composer is back in Ask.
  await page.goto(conversationUrl);
  const proposed = page.getByRole("region", { name: "Proposed changes" });
  await expect(proposed).toContainText("New issue NEX-2: Write the judge instructions");
  await expect(proposed.getByText("Accepted", { exact: true })).toHaveCount(3);
  await expect(page.getByText("You asked Nexus to edit:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Ask again in the same conversation: NEX-2 now tracks the action (whose line now names it),
  // NEX-1 still tracks the calendar work, and Ask writes nothing.
  const before = await workspaceHashes(ws);
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(QUESTION);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(3);
  const facts = lastAnswer(page).getByRole("region", { name: "Recorded facts" });
  await expect(facts).toContainText("“Will writes the judge instructions (NEX-2)” is tracked by NEX-2 (Write the judge instructions, to do).");
  await expect(facts).toContainText("“Hein builds the calendar view” is tracked by NEX-1");
  await expect(facts).not.toContainText("has no matching issue");
  expect(await workspaceHashes(ws)).toEqual(before);
});

test("rejecting the new issue lists what depends on it, undoes all three after a restart, and keeps an unrelated manual edit", async ({ page, browser }) => {
  const { ws, profile } = await setUp(page);
  await askForEdit(page);
  await expect(page.locator(".pending-block")).toContainText("(NEX-2)");

  // An unrelated manual edit to the same note while the changes await review.
  const api = await apiSession(svc!);
  const current = (await api("GET", `/notes/content?path=${encodeURIComponent(NOTE)}`)).body;
  const manual = current.content.replace("- Which free model route do we use for the live demo?", "- Which free model route do we use for the live demo? Hein checks Groq.");
  expect((await api("PUT", "/notes/content", { path: NOTE, content: manual, baseRevision: current.revision })).status).toBe(200);

  // Restart while pending: the changes are restored to the review bar.
  await svc!.stop();
  svc = await startService(profile);
  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  await page2.goto(await launchUrl(svc));
  await expect(bar(page2)).toContainText("Change 1 of 3");
  await expect(bar(page2)).toContainText(LABEL);

  // Open the new issue from the answer's list of proposed changes: its review notice is highlighted.
  await page2.getByRole("link", { name: QUESTION }).click();
  const proposed = page2.getByRole("region", { name: "Proposed changes" });
  await expect(proposed.getByText("Awaiting your review", { exact: true })).toHaveCount(3);
  await proposed.getByRole("link", { name: "New issue NEX-2: Write the judge instructions" }).click();
  await expect(page2.getByRole("heading", { name: "NEX-2 Write the judge instructions" })).toBeVisible();
  const notice = page2.locator(".pending-change", { hasText: "this whole issue was proposed" });
  await expect(notice).toBeFocused();
  await expect(page2.getByRole("link", { name: "← Back to conversation" })).toBeVisible();

  // Reject the new issue: Nexus lists the link and the note line first.
  await page2.getByRole("button", { name: "Reject new issue" }).click();
  const confirm = page2.getByRole("group", { name: "Reject related changes" });
  await expect(confirm).toContainText("NEX-2 link to");
  await expect(confirm).toContainText("Will writes the judge instructions (NEX-2)");
  // Cancelling changes nothing.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await issues(ws)).map((i) => i.key)).toEqual(["NEX-1", "NEX-2"]);
  await page2.getByRole("button", { name: "Reject new issue" }).click();
  await page2.getByRole("group", { name: "Reject related changes" }).getByRole("button", { name: "Reject all 3" }).click();
  await expect(bar(page2)).toContainText("Rejected and undone: New issue NEX-2: Write the judge instructions, with 2 related changes");
  await expect(page2.getByRole("heading", { name: /^NEX / })).toBeVisible(); // the project's board

  const note = await noteText(ws);
  expect(note).toContain("- [ ] Will writes the judge instructions\n");
  expect(note).not.toContain("NEX-2");
  expect(note).toContain("Hein checks Groq.");
  expect((await issues(ws)).map((i) => i.key)).toEqual(["NEX-1"]);
  expect(await journalStates(ws)).toEqual([`${LABEL}: note.replaceSpan rejected`, `${LABEL}: record.addLink rejected`, `${LABEL}: record.create rejected`]);
  await fresh.close();
});
