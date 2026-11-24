// B5 review journey on a copy of the fictional sample: real files, per-change decisions, restart.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let svc: Service | null = null;
const noteText = (ws: string) => readFile(join(ws, "meetings", "2026-11-24 kickoff.md"), "utf8");
const nex1Due = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues[0].due;
const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });

test.beforeEach(async () => { base = await tempDir("nexus-b5-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

test("apply the fixed demo, accept the note change, reject the date with a reason, survive a restart", async ({ page, browser }) => {
  const profile = join(base, "profile");
  const ws = join(base, "ws");
  svc = await startService(profile, ws, ["--init-sample"]);
  await page.goto(await launchUrl(svc));

  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  // The note opens on the exact changed list item, highlighted, with a persistent marker.
  const block = page.locator(".pending-block");
  await expect(block).toContainText("Hein builds the calendar view");
  await expect(block).toContainText("Pending review");
  await expect(block).toBeFocused();
  await expect(bar(page)).toContainText("Demo operations (fixed, not AI)");
  await expect(bar(page)).toContainText("Change 1 of 2");
  expect(await noteText(ws)).toContain("- [x] Hein builds the calendar view\n");
  expect(await nex1Due(ws)).toEqual({ date: "2026-12-03" });

  // Accept the note change; the bar moves to the issue page and its due-date field.
  await bar(page).getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await expect(page.locator("label.pending-field")).toContainText("Due date");
  await expect(page.getByText("Due date: 5 Dec 2026 → 3 Dec 2026")).toBeVisible();
  await expect(bar(page)).toContainText("Change 1 of 1");

  // Reject the date; it is undone at once, then Nexus asks why.
  await bar(page).getByRole("button", { name: "Reject" }).click();
  await expect(page.getByLabel("What was wrong, or what should be kept? (optional)")).toBeFocused();
  expect(await nex1Due(ws)).toEqual({ date: "2026-12-05" });
  await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("2026-12-05");
  await page.getByLabel("What was wrong, or what should be kept? (optional)").fill("Keep 5 December: Hein is away on the 3rd.");
  await page.getByRole("button", { name: "Send reason" }).click();
  await expect(bar(page)).toContainText("Your reason is saved");
  expect(await noteText(ws)).toContain("- [x] Hein builds the calendar view\n");

  // Restart: nothing is left pending, and the files keep exactly the accepted result.
  await svc.stop();
  svc = await startService(profile);
  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  await page2.goto(await launchUrl(svc));
  await expect(page2.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  await expect(bar(page2)).toHaveCount(0);
  expect(await noteText(ws)).toContain("- [x] Hein builds the calendar view\n");
  expect(await nex1Due(ws)).toEqual({ date: "2026-12-05" });
  const journalDir = join(ws, ".nexus", "reviews");
  const [journal] = (await import("node:fs/promises").then((fs) => fs.readdir(journalDir)));
  const run = JSON.parse(await readFile(join(journalDir, journal!), "utf8"));
  expect(run.changes.map((c: { state: string }) => c.state)).toEqual(["accepted", "rejected"]);
  expect(run.changes[1].feedback.text).toContain("Hein is away");
  await fresh.close();
});

test("reduced motion uses a static outline, decisions work from the keyboard, and an unsaved draft survives a landing change", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(await launchUrl(svc));

  // Open the note with an unsaved draft.
  await page.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent("meetings/2026-11-24 kickoff.md")}`);
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: /Markdown for/ });
  const draft = (await editor.inputValue()) + "\nMy unsaved draft line.\n";
  await editor.fill(draft);

  // A change lands from outside this tab (the same fixed demo, through the API).
  await page.evaluate(async () => {
    const token = sessionStorage.getItem("nexus.session");
    await fetch("/api/v1/review/demo", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  });
  await expect(page.getByTestId("disk-changed")).toBeVisible();
  await expect(editor).toHaveValue(draft);
  await page.getByRole("button", { name: "Load the new version (discard mine)" }).click();

  // Reach the change with the keyboard, check the reduced-motion highlight.
  const show = bar(page).getByRole("button", { name: "Show" });
  await show.focus();
  await expect(show).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  const block = page.locator(".pending-block");
  await expect(block).toBeVisible();
  const style = await block.evaluate((el) => ({ animation: getComputedStyle(el).animationName, outline: getComputedStyle(el).outlineWidth }));
  expect(style.animation).toBe("none");
  await expect(block).toContainText("Pending review");

  const accept = bar(page).getByRole("button", { name: "Accept" });
  await accept.focus();
  await expect(accept).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  const reject = bar(page).getByRole("button", { name: "Reject" });
  await reject.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("What was wrong, or what should be kept? (optional)")).toBeFocused();
  // "Send reason" is disabled while the reason is empty, so it is skipped in the tab order.
  await expect(page.getByRole("button", { name: "Send reason" })).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Skip" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await nex1Due(ws)).toEqual({ date: "2026-12-05" });
  expect(await noteText(ws)).toContain("- [x] Hein builds the calendar view\n");
});
