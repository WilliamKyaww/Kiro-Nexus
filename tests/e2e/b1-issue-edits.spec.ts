// Phase 1 repair 3: issue edits in two tabs, and link changes with unsaved fields.
// Reproduced on 2310608: after a live refresh, tab A silently overwrote tab B's title,
// and adding a link cleared an unsaved title.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let ws: string;
let svc: Service | null = null;
const nex1 = async () => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues[0];
const title = (p: Page) => p.getByRole("textbox", { name: "Title", exact: true });
const description = (p: Page) => p.getByRole("textbox", { name: "Description", exact: true });

test.beforeEach(async () => {
  base = await tempDir("nexus-issues-");
  ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

async function twoTabs(browser: Browser): Promise<[Page, Page]> {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  for (const p of [a, b]) {
    await p.goto(await launchUrl(svc!));
    await p.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1`);
    await expect(title(p)).toHaveValue("Build calendar view");
  }
  return [a, b];
}

test("two tabs editing the same title: the second gets a conflict, not a silent overwrite", async ({ browser }) => {
  const [a, b] = await twoTabs(browser);
  await title(a).fill("Title from tab A");
  await title(b).fill("Title from tab B");
  await b.getByRole("button", { name: "Save issue" }).click();
  await expect(b.getByText("Saved · revision 2")).toBeVisible();
  await expect(a.getByTestId("changed-elsewhere")).toContainText("Title changed elsewhere"); // live refresh noticed it
  await expect(title(a)).toHaveValue("Title from tab A");
  await a.getByRole("button", { name: "Save issue" }).click();
  await expect(a.getByTestId("issue-conflict")).toContainText("theirs “Title from tab B”, yours “Title from tab A”");
  expect((await nex1()).title).toBe("Title from tab B");
  await a.getByRole("button", { name: "Keep mine" }).click();
  await expect(a.getByText("Saved · revision 3")).toBeVisible();
  expect(await nex1()).toMatchObject({ title: "Title from tab A", revision: 3 });
});

test("two tabs editing different fields: both edits survive in the form and the JSON", async ({ browser }) => {
  const [a, b] = await twoTabs(browser);
  await description(a).fill("Description from tab A");
  await title(b).fill("Title from tab B");
  await b.getByRole("button", { name: "Save issue" }).click();
  await expect(b.getByText("Saved · revision 2")).toBeVisible();
  await expect(title(a)).toHaveValue("Title from tab B"); // the newer unrelated edit is shown
  await expect(description(a)).toHaveValue("Description from tab A");
  await a.getByRole("button", { name: "Save issue" }).click();
  await expect(a.getByText("Saved · revision 3")).toBeVisible();
  expect(await nex1()).toMatchObject({ title: "Title from tab B", description: "Description from tab A", revision: 3 });
  await expect(title(b)).toHaveValue("Title from tab B");
  await expect(description(b)).toHaveValue("Description from tab A");
});

test("adding and removing a note link keeps an unsaved title and description", async ({ page }) => {
  await page.goto(await launchUrl(svc!));
  await page.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1`);
  await title(page).fill("Unsaved title");
  await description(page).fill("Unsaved description");
  await page.getByTestId("link-note").selectOption("meetings/2026-11-24 kickoff.md");
  await page.getByTestId("link-heading").selectOption("decisions");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByTestId("open-linked-note")).toHaveCount(2);
  await expect(title(page)).toHaveValue("Unsaved title");
  await expect(description(page)).toHaveValue("Unsaved description");
  await expect(page.locator(".save-state")).toHaveText("Unsaved changes");
  expect((await nex1()).noteLinks.map((l: { headingSlug: string }) => l.headingSlug)).toEqual(["actions", "decisions"]);
  expect((await nex1()).title).toBe("Build calendar view");

  await page.getByRole("button", { name: /Remove link to meetings\/2026-11-24 kickoff.md › Actions/ }).click();
  await expect(page.getByTestId("open-linked-note")).toHaveCount(1);
  await expect(title(page)).toHaveValue("Unsaved title");
  await expect(description(page)).toHaveValue("Unsaved description");

  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.locator(".save-state")).toHaveText(/Saved · revision/);
  expect(await nex1()).toMatchObject({ title: "Unsaved title", description: "Unsaved description",
    noteLinks: [{ notePath: "meetings/2026-11-24 kickoff.md", headingSlug: "decisions", headingText: "Decisions" }] });
});
