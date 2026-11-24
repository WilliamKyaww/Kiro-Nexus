// Run 5, stage 1: browser checks for the run-4 review findings that show in the UI (reviewer:
// the Codex extension, designated Astra 6.2, run by Will). Disposable copies of the fictional
// sample; Edit runs use the deterministic provider double (a labelled fixture, not AI).
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

test.use({ trace: "off", screenshot: "off" });
const NOTE = "meetings/2026-11-24 kickoff.md";
let double: ProviderDouble;
let base: string;
let svc: Service | null = null;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => { base = await tempDir("nexus-r5-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

const issuesOnDisk = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<{ key: string; due: unknown; title: string }>;
const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });
const card = (page: Page, key: string) => page.getByTestId(`card-${key}`);

/** A provider profile for the test double, the kickoff answer, then an Edit request, all through the API. */
async function editThroughApi(s: Service) {
  const api = await apiSession(s);
  const p = (await api("POST", "/providers", { name: "Test double", baseUrl: double.baseUrl, model: "nexus-test-double" })).body;
  await api("PUT", `/providers/${p.id}/session-key`, { key: "nexus-fake-r5-key" });
  await api("POST", `/providers/${p.id}/test`);
  const conv = (await api("POST", "/conversations", {})).body;
  const ask = async (question: string, mode: "ask" | "edit") => {
    await api("POST", `/conversations/${conv.id}/ask`, { question, mode });
    for (let i = 0; i < 100; i++) {
      const c = (await api("GET", `/conversations/${conv.id}`)).body;
      if (!c.messages.some((m: { status: string }) => m.status === "running")) return c;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("no answer");
  };
  await ask("Which action from the kickoff still has no issue?", "ask");
  await ask("Create the missing issue, link it to its source heading and update the note line.", "edit");
  return { api, conversationId: conv.id as string };
}

test("R4-5: a date drafted in one board does not overwrite another tab's newer date", async ({ browser }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto(await launchUrl(svc));
    await expect(p.getByRole("heading", { name: "What do you need?" })).toBeVisible(); // the session is in place
    await p.goto(`http://127.0.0.1:${svc.port}/projects/NEX`);
  }
  await card(a, "NEX-1").getByRole("button", { name: "Change due date" }).click();
  await card(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-09");
  await card(b, "NEX-1").getByRole("button", { name: "Change due date" }).click();
  await card(b, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-12");
  await card(b, "NEX-1").getByRole("button", { name: "Save date" }).click();
  await expect(card(a, "NEX-1")).toContainText("12 Dec 2026"); // A's card refreshes with B's date
  await card(a, "NEX-1").getByRole("button", { name: "Save date" }).click();
  await expect(card(a, "NEX-1").getByRole("alert")).toContainText("Someone else changed this due date to Sat 12 Dec 2026 since you started. Your date, Wed 9 Dec 2026, is not saved.");
  await expect(card(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true })).toHaveValue("2026-12-09"); // the draft is kept
  expect((await issuesOnDisk(ws))[0]!.due).toEqual({ date: "2026-12-12" });
  await svc.stop();
  svc = await startService(join(base, "profile"));
  expect((await issuesOnDisk(ws))[0]!.due).toEqual({ date: "2026-12-12" });
});

test("R4-7: an old link to a rejected proposed issue says so, and its key is not reused", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  const { api } = await editThroughApi(svc);
  const create = (await api("GET", "/review/changes?state=open")).body.changes.find((c: { kind: string }) => c.kind === "record.create");
  expect(create.recordKey).toBe("NEX-2");
  expect((await api("POST", `/review/changes/${create.changeId}/reject?withDependents=1`)).status).toBe(200);
  const project = (await api("GET", "/projects")).body.projects[0];
  expect((await api("POST", "/issues", { projectId: project.id, title: "Book venue lighting" })).body.key).toBe("NEX-3");
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/issues/NEX-2`); // the bookmarked board link
  await expect(page.getByRole("heading", { name: "NEX-2 does not exist" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("NEX-2 “Write the judge instructions” was proposed by an edit (Edit by nexus-test-double (test double, not AI)) and rejected on");
  await expect(page.getByText("Book venue lighting")).toHaveCount(0);
});

test("R4-3: a note line that names a never-written issue cannot be accepted, and Discard undoes it after asking", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"], { NEXUS_FAULT_THROW: "review:write:.nexus/issues.json" });
  await editThroughApi(svc);
  expect(await readFile(join(ws, ...NOTE.split("/")), "utf8")).toContain("(NEX-2)");
  await page.goto(await launchUrl(svc));
  await expect(bar(page)).toContainText("Not written:");
  await page.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent(NOTE)}`);
  await bar(page).getByRole("button", { name: "Show" }).or(bar(page).getByRole("button", { name: "Accept", exact: true })).first().click();
  await bar(page).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(bar(page)).toContainText("which was never written (use Retry or Discard)");
  expect((await issuesOnDisk(ws)).map((i) => i.key)).toEqual(["NEX-1"]);
  await bar(page).getByRole("button", { name: "Discard unwritten changes" }).click();
  const confirm = page.getByRole("group", { name: "Discard and undo related changes" });
  await expect(confirm).toContainText("Will writes the judge instructions (NEX-2)");
  await confirm.getByRole("button", { name: "Discard and undo" }).click();
  await expect(bar(page)).toContainText("rejected and undid the change that needed them");
  const note = await readFile(join(ws, ...NOTE.split("/")), "utf8");
  expect(note).toContain("- [ ] Will writes the judge instructions\n");
  expect(note).not.toContain("NEX-2");
});

test("R4-10: the date editor names its zone, the calendar shows the workspace time, and a clock-gap time is flagged", async ({ page }) => {
  const ws = join(base, "ws");
  await cp(join(process.cwd(), "samples", "meeting-workspace"), ws, { recursive: true });
  const manifest = JSON.parse(await readFile(join(ws, ".nexus", "workspace.json"), "utf8"));
  await writeFile(join(ws, ".nexus", "workspace.json"), JSON.stringify({ ...manifest, timeZone: "Asia/Tokyo" }, null, 2) + "\n");
  const file = JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"));
  file.issues[0].due = { dateTime: "2027-03-27T23:30:00.000Z", timeZone: "Europe/London" };                  // 23:30 London, 27 March
  file.issues.push({ ...file.issues[0], id: "iss_01KAR5Y3S2M8Q4K7Y2C9X5V6C4", key: "NEX-2", title: "Send the early reminder", rank: "00000002",
    noteLinks: [], due: { dateTime: "2027-03-27T01:30:00.000Z", timeZone: "Europe/London" } });                // 01:30 London, 27 March
  await writeFile(join(ws, ".nexus", "issues.json"), JSON.stringify(file, null, 2) + "\n");
  const projects = JSON.parse(await readFile(join(ws, ".nexus", "projects.json"), "utf8"));
  projects.projects[0].nextIssueNumber = 3;
  await writeFile(join(ws, ".nexus", "projects.json"), JSON.stringify(projects, null, 2) + "\n");
  svc = await startService(join(base, "profile"), ws);
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/calendar?month=2027-03`);
  const day28 = page.locator('li.day[data-date="2027-03-28"]');
  await expect(day28.getByTestId("due-NEX-1")).toContainText("08:30"); // the day and time in Tokyo
  await day28.getByTestId("due-NEX-1").getByRole("button").click();
  const editor = page.getByRole("form", { name: "Change the due date of NEX-1" });
  await expect(editor.getByLabel("Due date of NEX-1", { exact: true })).toHaveValue("2027-03-27");
  await expect(editor).toContainText("Due at 23:30 London time (Europe/London). The date is the day in that zone. The calendar shows it on Sun 28 Mar 2027, the day in this workspace's zone (Asia/Tokyo).");
  await editor.getByRole("button", { name: "Cancel" }).click();

  await page.locator('li.day[data-date="2027-03-27"]').getByTestId("due-NEX-2").getByRole("button").click();
  const gap = page.getByRole("form", { name: "Change the due date of NEX-2" });
  await gap.getByLabel("Due date of NEX-2", { exact: true }).fill("2027-03-28");
  await expect(gap.getByRole("status")).toHaveText("01:30 does not exist on Sun 28 Mar 2027 in Europe/London, because the clocks go forward. Nexus will save 02:30.");
  await gap.getByRole("button", { name: "Save date" }).click();
  await expect.poll(async () => (await issuesOnDisk(ws)).find((i) => i.key === "NEX-2")!.due).toEqual({ dateTime: "2027-03-28T01:30:00.000Z", timeZone: "Europe/London" });
});
