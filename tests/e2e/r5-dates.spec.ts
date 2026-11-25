// Run 6, stage 1: browser checks for the run-5 review findings about due dates (reviewer: the
// Codex extension, designated Astra 6.2, run by Will). R5-11: a calendar draft must survive its
// issue moving to another day after another tab's save. R5-12: issue details must keep a timed
// deadline's time and zone. Disposable copies of the fictional sample only.
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";
test.use({ trace: "off", screenshot: "off" });
let base: string;
let svc: Service | null = null;
test.beforeEach(async () => { base = await tempDir("nexus-r5-dates-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });
const issuesOnDisk = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<{ key: string; due: unknown; revision: number }>;
const dueOf = async (ws: string, key: string) => (await issuesOnDisk(ws)).find((i) => i.key === key)!.due;
const day = (page: Page, date: string) => page.locator(`li.day[data-date="${date}"]`);
const card = (page: Page, key: string) => page.getByTestId(`card-${key}`);
const editor = (page: Page, key: string) => page.getByRole("form", { name: `Change the due date of ${key}` });
/** B saves a date from the board, as another person would. */
async function saveOnBoard(b: Page, key: string, date: string) {
  await card(b, key).getByRole("button", { name: "Change due date" }).click();
  await card(b, key).getByLabel(`Due date of ${key}`, { exact: true }).fill(date);
  await card(b, key).getByRole("button", { name: "Save date" }).click();
  await expect(card(b, key).getByRole("form")).toHaveCount(0); // B's editor closes after its save
}
test("R5-11: a calendar draft follows its issue when another tab moves it, and asks which date to keep", async ({ browser }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto(await launchUrl(svc));
    await expect(p.getByRole("heading", { name: "What do you need?" })).toBeVisible(); // the session is in place
  }
  await a.goto(`http://127.0.0.1:${svc.port}/calendar?month=2026-12`);
  await b.goto(`http://127.0.0.1:${svc.port}/projects/NEX`);
  // A drafts 9 December on the calendar; B saves 12 December on the board.
  await day(a, "2026-12-05").getByTestId("due-NEX-1").getByRole("button").click();
  await editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-09");
  await saveOnBoard(b, "NEX-1", "2026-12-12");
  // A's item moves to the 12th, and the editor goes with it, draft and all.
  await expect(day(a, "2026-12-12").getByTestId("due-NEX-1")).toBeVisible();
  await expect(day(a, "2026-12-12").getByRole("form", { name: "Change the due date of NEX-1" })).toBeVisible();
  await expect(editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true })).toHaveValue("2026-12-09");
  await expect(editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true })).toBeFocused(); // typing can carry on
  await expect(editor(a, "NEX-1").getByRole("alert")).toHaveText(/Someone else changed this due date to Sat 12 Dec 2026 since you started\. Your date, Wed 9 Dec 2026, is not saved\./);
  expect(await dueOf(ws, "NEX-1")).toEqual({ date: "2026-12-12" });
  // Use theirs: the draft goes, the stored date stays.
  await editor(a, "NEX-1").getByRole("button", { name: "Use theirs" }).click();
  await expect(editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true })).toHaveValue("2026-12-12");
  await expect(editor(a, "NEX-1").getByRole("alert")).toHaveCount(0);
  expect(await dueOf(ws, "NEX-1")).toEqual({ date: "2026-12-12" });
  // A drafts again; B moves the issue out of December altogether (4 January is not in the grid).
  await editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-09");
  await saveOnBoard(b, "NEX-1", "2027-01-04");
  await expect(a.getByTestId("due-NEX-1")).toHaveCount(0); // not on any day shown
  const moved = a.getByRole("region", { name: "Unsaved dates outside this month" });
  await expect(moved).toContainText("NEX-1 Build calendar view is due on Mon 4 Jan 2027, outside December 2026. Your unsaved date is still here.");
  await expect(editor(a, "NEX-1").getByLabel("Due date of NEX-1", { exact: true })).toHaveValue("2026-12-09");
  await expect(editor(a, "NEX-1").getByRole("alert")).toHaveText(/Someone else changed this due date to Mon 4 Jan 2027 since you started\. Your date, Wed 9 Dec 2026, is not saved\./);
  // Keep mine: A's date is saved over B's, knowingly, and the item comes back to the 9th.
  await editor(a, "NEX-1").getByRole("button", { name: "Keep mine" }).click();
  await expect.poll(() => dueOf(ws, "NEX-1")).toEqual({ date: "2026-12-09" });
  await expect(day(a, "2026-12-09").getByTestId("due-NEX-1")).toBeVisible();
  await expect(editor(a, "NEX-1")).toHaveCount(0);
  await expect(moved).toHaveCount(0);
  await expect(card(b, "NEX-1")).toContainText("Due 9 Dec 2026");
});
test("R5-11: a calendar date saved from the same tab still closes its editor on the new day", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/calendar?month=2026-12`);
  await day(page, "2026-12-05").getByTestId("due-NEX-1").getByRole("button").click();
  await editor(page, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-08");
  await editor(page, "NEX-1").getByRole("button", { name: "Save date" }).click();
  await expect(day(page, "2026-12-08").getByTestId("due-NEX-1")).toBeVisible();
  await expect(editor(page, "NEX-1")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0); // its own save is not someone else's change
  expect(await dueOf(ws, "NEX-1")).toEqual({ date: "2026-12-08" });
});
/** A copy of the sample with NEX-1 due at a timed instant, and an optional second issue. */
async function timedWorkspace(ws: string, nex1Due: unknown, nex2Due?: unknown) {
  await cp(join(process.cwd(), "samples", "meeting-workspace"), ws, { recursive: true });
  const file = JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"));
  file.issues[0].due = nex1Due;
  if (nex2Due) {
    file.issues.push({ ...file.issues[0], id: "iss_01KAR5Y3S2M8Q4K7Y2C9X5V6D7", key: "NEX-2", title: "Send the early reminder", rank: "00000002", noteLinks: [], due: nex2Due });
    const projects = JSON.parse(await readFile(join(ws, ".nexus", "projects.json"), "utf8"));
    projects.projects[0].nextIssueNumber = 3;
    await writeFile(join(ws, ".nexus", "projects.json"), JSON.stringify(projects, null, 2) + "\n");
  }
  await writeFile(join(ws, ".nexus", "issues.json"), JSON.stringify(file, null, 2) + "\n");
}
test("R5-12: issue details show a timed deadline and keep its time and zone when the date changes", async ({ page }) => {
  const ws = join(base, "ws");
  await timedWorkspace(ws, { dateTime: "2026-12-10T23:15:00.000Z", timeZone: "Europe/London" }); // 23:15 London, 10 December
  svc = await startService(join(base, "profile"), ws);
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/issues/NEX-1`);
  const field = page.getByLabel("Due date", { exact: true });
  await expect(field).toHaveValue("2026-12-10");
  await expect(page.getByRole("form", { name: "Issue details" })).toContainText("Due at 23:15 London time (Europe/London). The date is the day in that zone.");
  await field.fill("2026-12-15");
  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saved · revision 2");
  expect(await dueOf(ws, "NEX-1")).toEqual({ dateTime: "2026-12-15T23:15:00.000Z", timeZone: "Europe/London" });
  await page.reload();
  await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("2026-12-15");
  await expect(page.getByRole("form", { name: "Issue details" })).toContainText("Due at 23:15 London time (Europe/London).");
});
test("R5-12: issue details flag a clock-gap time before saving, as the board and calendar do", async ({ page }) => {
  const ws = join(base, "ws");
  await timedWorkspace(ws, { date: "2026-12-05" }, { dateTime: "2027-03-27T01:30:00.000Z", timeZone: "Europe/London" }); // 01:30 London, 27 March
  svc = await startService(join(base, "profile"), ws);
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/issues/NEX-2`);
  const field = page.getByLabel("Due date", { exact: true });
  await expect(field).toHaveValue("2027-03-27");
  await field.fill("2027-03-28");
  await expect(page.getByRole("form", { name: "Issue details" }).getByRole("status").filter({ hasText: "clocks go forward" }))
    .toHaveText("01:30 does not exist on Sun 28 Mar 2027 in Europe/London, because the clocks go forward. Nexus will save 02:30.");
  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saved · revision 2");
  expect(await dueOf(ws, "NEX-2")).toEqual({ dateTime: "2027-03-28T01:30:00.000Z", timeZone: "Europe/London" });
  // An all-day date stays all-day.
  await page.goto(`http://127.0.0.1:${svc.port}/issues/NEX-1`);
  await expect(page.getByRole("form", { name: "Issue details" })).toContainText("An all-day date in this workspace's zone (Europe/London).");
  await page.getByLabel("Due date", { exact: true }).fill("2026-12-06");
  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saved · revision 2");
  expect(await dueOf(ws, "NEX-1")).toEqual({ date: "2026-12-06" });
});
