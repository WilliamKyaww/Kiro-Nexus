// Phase 1 repair 4: the selected change and its decisions are visible together on narrow
// and desktop screens; Home has a working action with AI off; no internal wording.
// Reproduced on 2310608 at 390 × 844: the fixed review bar (217 px) covered the screen
// and started above the start of the note.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let svc: Service | null = null;
test.beforeEach(async () => {
  base = await tempDir("nexus-usability-");
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });

async function expectAboveBar(page: Page, target: Locator) {
  const viewport = page.viewportSize()!;
  await expect.poll(async () => {
    const t = await target.boundingBox();
    const b = await bar(page).boundingBox();
    return !!t && !!b && t.y >= 0 && t.y + t.height <= b.y + 1 && b.y + b.height <= viewport.height + 1;
  }, { timeout: 5000 }).toBe(true);
}

for (const [name, viewport] of [["narrow 390 × 844", { width: 390, height: 844 }], ["desktop 1360 × 900", { width: 1360, height: 900 }]] as const) {
  test(`${name}: each change and its Accept and Reject are visible together`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(await launchUrl(svc!));
    await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
    const block = page.locator(".pending-block");
    await expect(block).toBeFocused();
    await expectAboveBar(page, block);
    await expect(bar(page).getByRole("button", { name: "Accept" })).toBeInViewport();
    await expect(bar(page).getByRole("button", { name: "Reject" })).toBeInViewport();
    await expect(bar(page)).toContainText("Demo operations (fixed, not AI)");

    // Opening the note directly (no jump): the note itself starts above the bar.
    await page.goto(`http://127.0.0.1:${svc!.port}/notes?path=${encodeURIComponent("meetings/2026-11-24 kickoff.md")}`);
    await expect(page.locator(".note-main")).toBeVisible();
    await expect(bar(page)).toBeVisible();
    const noteTop = (await page.locator(".note-main").boundingBox())!.y;
    const barTop = (await bar(page).boundingBox())!.y;
    expect(noteTop).toBeLessThan(barTop - 100);
    if (viewport.width === 390) await page.screenshot({ path: ".tmp/narrow-note.png" });
    await bar(page).getByRole("button", { name: "Show" }).click();
    await expectAboveBar(page, block);

    await bar(page).getByRole("button", { name: "Accept" }).click();
    const field = page.locator("label.pending-field");
    await expect(field).toContainText("Due date");
    await expectAboveBar(page, field);
    await expect(bar(page).getByRole("button", { name: "Reject" })).toBeInViewport();
  });
}

test("narrow screen with reduced motion: static outline, keyboard decisions still work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(await launchUrl(svc!));
  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  const block = page.locator(".pending-block");
  await expect(block).toBeFocused();
  expect(await block.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  const accept = bar(page).getByRole("button", { name: "Accept" });
  await accept.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
});

test("Home offers a working action with AI off, at both widths", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1360, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(await launchUrl(svc!));
    const open = page.getByRole("link", { name: "Open the kickoff meeting note" });
    await expect(open).toBeInViewport();
    await open.click();
    await expect(page.getByRole("heading", { name: "Kickoff, 24 November 2026" })).toBeVisible();
  }
});

test("product screens contain no internal planning words", async ({ page }) => {
  await page.goto(await launchUrl(svc!));
  for (const path of ["/", "/notes", "/projects", "/projects/NEX", "/issues/NEX-1", "/calendar", "/notifications", "/settings", "/workspace"]) {
    await page.goto(`http://127.0.0.1:${svc!.port}${path}`);
    await expect(page.locator("main")).not.toBeEmpty();
    // The workspace and profile paths are the user's own folders, shown as they are (a checkout
    // called Kiro-Nexus, for example). Only Nexus's fixed copy is checked (R5 portability).
    const text = (await page.locator("body").innerText()).split(join(base, "ws")).join("<workspace>").split(base).join("<temp>");
    expect(text, path).not.toMatch(/\bslice\b|Hein's board|\bB[1-5]\b|Kiro/i);
  }
});
