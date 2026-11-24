// Phase 1 repair 2: note drafts survive navigation, Back, review jumps and in-flight saves.
// Reproduced on 2310608: a draft vanished after visiting Projects, and text typed during
// a slow save disappeared when it completed while the UI said "Saved".
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let ws: string;
let svc: Service | null = null;
const NOTE = "meetings/2026-11-24 kickoff.md";
const file = () => join(ws, ...NOTE.split("/"));
const editor = (page: Page) => page.getByRole("textbox", { name: /Markdown for/ });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  base = await tempDir("nexus-drafts-");
  ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent(NOTE)}`);
  await page.getByRole("button", { name: "Edit" }).click();
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

test("a draft survives visiting Projects, an issue link and the Back button", async ({ page }) => {
  const draft = (await editor(page).inputValue()) + "\nDraft paragraph one.\n";
  await editor(page).fill(draft);
  await nav(page, "Projects");
  await nav(page, "Notes");
  await expect(page.getByRole("link", { name: /2026-11-24 kickoff · unsaved draft/ })).toBeVisible();
  await page.getByRole("link", { name: /2026-11-24 kickoff/ }).click();
  await expect(editor(page)).toHaveValue(draft);
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("Unsaved changes");

  await page.getByRole("complementary", { name: "About this note" }).getByRole("link", { name: /NEX-1/ }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await page.goBack();
  await expect(editor(page)).toHaveValue(draft);
  expect(await readFile(file(), "utf8")).not.toContain("Draft paragraph one.");
});

test("a draft survives an automatic review jump to its own note", async ({ page }) => {
  const draft = (await editor(page).inputValue()) + "\nDraft kept through the review jump.\n";
  await editor(page).fill(draft);
  await nav(page, "Home");
  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  await expect(page.getByTestId("disk-changed")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(editor(page)).toHaveValue(draft);
});

test("a save acknowledgement clears only the text that was submitted (deliberately delayed save)", async ({ page }) => {
  await page.route("**/api/v1/notes/content", async (route) => {
    if (route.request().method() === "PUT") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await editor(page).fill("# Kickoff\n\nFirst version.\n");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saving…");
  await editor(page).fill("# Kickoff\n\nFirst version.\n\nTyped while saving.\n");
  await expect.poll(() => readFile(file(), "utf8")).toBe("# Kickoff\n\nFirst version.\n");
  await expect(page.locator(".save-state")).toHaveText("Unsaved changes");
  await expect(editor(page)).toHaveValue("# Kickoff\n\nFirst version.\n\nTyped while saving.\n");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saved", { timeout: 5000 });
  expect(await readFile(file(), "utf8")).toBe("# Kickoff\n\nFirst version.\n\nTyped while saving.\n");
});

test("Compare and choose shows the actual disk text and the draft before anything is overwritten", async ({ page }) => {
  const draft = (await editor(page).inputValue()) + "\nMy draft line.\n";
  await editor(page).fill(draft);
  const outside = "# Kickoff\n\nRewritten in another editor.\n";
  await writeFile(file(), outside);
  await expect(page.getByTestId("disk-changed")).toBeVisible({ timeout: 4000 });
  await page.getByRole("button", { name: "Compare and choose" }).click();
  await expect(page.getByTestId("compare-disk")).toHaveText(outside);
  await expect(page.getByTestId("compare-draft")).toHaveText(draft);
  expect(await readFile(file(), "utf8")).toBe(outside);
  await page.getByRole("button", { name: "Overwrite with mine" }).click();
  await expect(page.locator(".save-state")).toHaveText("Saved");
  expect(await readFile(file(), "utf8")).toBe(draft);
});
