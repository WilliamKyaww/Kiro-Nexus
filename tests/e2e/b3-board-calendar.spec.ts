// B3 first slice: the board and the month calendar, with AI off (no provider configured).
// Both views read and write the same issue record (PRD-030 to PRD-032).
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let ws: string;
let svc: Service | null = null;
const issuesOnDisk = async () => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<Record<string, any>>;
const issue = async (key: string) => (await issuesOnDisk()).find((i) => i.key === key)!;
const go = (page: Page, path: string) => page.goto(`http://127.0.0.1:${svc!.port}${path}`);
const card = (page: Page, key: string) => page.getByTestId(`card-${key}`);
const column = (page: Page, status: string) => page.getByTestId(`column-${status}`);
const day = (page: Page, date: string) => page.locator(`li.day[data-date="${date}"]`);

test.beforeEach(async () => {
  base = await tempDir("nexus-b3-");
  ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

async function restart(page: Page) {
  await svc!.stop();
  svc = await startService(join(base, "profile"), ws);
  await page.goto(await launchUrl(svc));
}

test("board: create, drag, keyboard move, priority and due date, kept after a restart", async ({ page, browser }) => {
  await page.goto(await launchUrl(svc!));
  await go(page, "/projects/NEX");
  await expect(page.getByRole("heading", { level: 1, name: "NEX Nexus hackathon" })).toBeVisible();
  await expect(column(page, "in_progress")).toContainText("NEX-1 Build calendar view");
  await expect(page.getByText("AI is off")).toHaveCount(0); // nothing here depends on AI

  // Create an issue from the board; it opens, and appears in To do.
  await page.getByRole("textbox", { name: "New issue" }).fill("Write the judge instructions");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: "NEX-2 Write the judge instructions" })).toBeVisible();
  await go(page, "/projects/NEX");
  await expect(column(page, "todo")).toContainText("NEX-2 Write the judge instructions");

  // Drag to In progress.
  await card(page, "NEX-2").dragTo(column(page, "in_progress"));
  await expect(column(page, "in_progress")).toContainText("NEX-2");
  await expect(page.locator(".board-announce")).toHaveText("NEX-2 moved to In progress.");
  await expect.poll(async () => (await issue("NEX-2")).status).toBe("in_progress");

  // Keyboard only: the focused card moves with Alt+Right Arrow, keeps focus, and is announced.
  await card(page, "NEX-2").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(column(page, "done")).toContainText("NEX-2");
  await expect(page.locator(".board-announce")).toHaveText("NEX-2 moved to Done.");
  await expect(card(page, "NEX-2")).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".board-announce")).toHaveText("NEX-2 is already in Done.");
  await expect.poll(async () => (await issue("NEX-2")).status).toBe("done");

  // Priority on the issue page shows on the card.
  await card(page, "NEX-2").getByRole("link", { name: /NEX-2/ }).click();
  await page.getByLabel("Priority").selectOption("urgent");
  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.locator(".save-state")).toHaveText(/Saved/);
  await go(page, "/projects/NEX");
  await expect(card(page, "NEX-2")).toContainText("Urgent");

  // Due date from the card.
  await card(page, "NEX-2").getByRole("button", { name: "Change due date" }).click();
  await card(page, "NEX-2").getByLabel("Due date of NEX-2", { exact: true }).fill("2026-12-10");
  await card(page, "NEX-2").getByRole("button", { name: "Save date" }).click();
  await expect(card(page, "NEX-2")).toContainText("Due 10 Dec 2026");
  await expect.poll(async () => (await issue("NEX-2")).due).toEqual({ date: "2026-12-10" });

  // Another tab renames NEX-1; a move from this (older) board keeps the new title.
  const other = await (await browser.newContext()).newPage();
  await other.goto(await launchUrl(svc!));
  await other.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1`);
  await other.getByRole("textbox", { name: "Title", exact: true }).fill("Build the month calendar");
  await other.getByRole("button", { name: "Save issue" }).click();
  await expect(other.locator(".save-state")).toHaveText(/Saved · revision 2/);
  await card(page, "NEX-1").getByLabel("Status of NEX-1").selectOption("done");
  await expect.poll(async () => (await issue("NEX-1")).status).toBe("done");
  expect(await issue("NEX-1")).toMatchObject({ title: "Build the month calendar", status: "done" });

  // After a restart the board shows exactly what is on disk.
  await restart(page);
  await go(page, "/projects/NEX");
  await expect(column(page, "done")).toContainText("NEX-2 Write the judge instructions");
  await expect(card(page, "NEX-2")).toContainText("Urgent");
  await expect(card(page, "NEX-2")).toContainText("Due 10 Dec 2026");
  await expect(column(page, "done")).toContainText("NEX-1 Build the month calendar");
  // The backlog view is kept.
  await page.getByRole("button", { name: "Backlog" }).click();
  await expect(page.getByRole("table")).toContainText("NEX-2");
});

test("calendar: one due date shared with the board, kept after a restart, with proposed dates marked", async ({ page }) => {
  await page.goto(await launchUrl(svc!));
  await go(page, "/calendar?month=2026-12");
  await expect(page.getByRole("heading", { name: "December 2026" })).toBeVisible();
  await expect(day(page, "2026-12-05")).toContainText("NEX-1 Build calendar view");

  // Keyboard: open the item, change the date, save with Enter.
  await day(page, "2026-12-05").getByRole("button", { name: /NEX-1/ }).focus();
  await page.keyboard.press("Enter");
  const input = page.getByLabel("Due date of NEX-1", { exact: true });
  await expect(input).toBeVisible();
  await input.fill("2026-12-08");
  await input.press("Enter");
  await expect(day(page, "2026-12-08")).toContainText("NEX-1");
  await expect(day(page, "2026-12-05")).not.toContainText("NEX-1");
  await expect.poll(async () => (await issue("NEX-1")).due).toEqual({ date: "2026-12-08" });

  // The board shows the same date; a change there moves it on the calendar.
  await go(page, "/projects/NEX");
  await expect(card(page, "NEX-1")).toContainText("Due 8 Dec 2026");
  await card(page, "NEX-1").getByRole("button", { name: "Change due date" }).click();
  await card(page, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-12");
  await card(page, "NEX-1").getByRole("button", { name: "Save date" }).click();
  await expect(card(page, "NEX-1")).toContainText("Due 12 Dec 2026");
  await go(page, "/calendar?month=2026-12");
  await expect(day(page, "2026-12-12")).toContainText("NEX-1");

  // Both views after a restart.
  await restart(page);
  await go(page, "/calendar?month=2026-12");
  await expect(day(page, "2026-12-12")).toContainText("NEX-1");
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "January 2027" })).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: "December 2026" })).toBeVisible();

  // A due date awaiting review: the accepted date stays, the proposed one is marked.
  await go(page, "/");
  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  await expect(page.locator(".pending-block")).toBeVisible();
  await go(page, "/calendar?month=2026-12");
  await expect(day(page, "2026-12-12").getByTestId("due-NEX-1")).toBeVisible();
  await expect(day(page, "2026-12-03").getByTestId("proposed-NEX-1")).toContainText("Proposed");
  await go(page, "/projects/NEX");
  await expect(card(page, "NEX-1")).toContainText("Due 12 Dec 2026 · proposed 3 Dec 2026");
  await expect(card(page, "NEX-1")).toContainText("Pending review");
  expect((await issue("NEX-1")).due).toEqual({ date: "2026-12-03" }); // the tentative value is on disk
});

test("narrow 390 × 844: the board stacks and the month reads as a list, with nothing cut off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(await launchUrl(svc!));
  for (const path of ["/projects/NEX", "/calendar?month=2026-12"]) {
    await go(page, path);
    await expect(page.locator("main")).not.toBeEmpty();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await expect(day(page, "2026-12-05").locator(".day-title")).toHaveText("Saturday 5 December");
  await expect(day(page, "2026-12-05").getByRole("button", { name: /NEX-1/ })).toBeVisible();
  await go(page, "/projects/NEX");
  const boxes = await Promise.all(["todo", "in_progress", "done"].map((s) => column(page, s).boundingBox()));
  expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(1); // one column above another
  await card(page, "NEX-1").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(column(page, "done")).toContainText("NEX-1");
});
