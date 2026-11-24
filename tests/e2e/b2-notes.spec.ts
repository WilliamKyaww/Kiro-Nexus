// B2 slice: section search and edits made in another editor while Nexus is open.
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let svc: Service | null = null;
const NOTE = "meetings/2026-11-24 kickoff.md";
test.beforeEach(async () => { base = await tempDir("nexus-b2-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

test("search lands on the matching heading", async ({ page }) => {
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
  await page.goto(await launchUrl(svc));
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Notes" }).click();
  await page.getByRole("searchbox", { name: "Search notes" }).fill("judge");
  const result = page.getByRole("region", { name: "Search results" }).getByRole("link", { name: /Kickoff, 24 November 2026 › Actions/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator(".heading-target")).toContainText("Actions");
  expect(page.url()).toContain("heading=actions");
});

test("an outside edit reloads a clean view, never discards a draft, and a deleted note can be recreated", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"]);
  const file = join(ws, ...NOTE.split("/"));
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent(NOTE)}`);
  await expect(page.getByText("Will writes the judge instructions")).toBeVisible();

  // 1. No draft: the preview follows the file.
  await writeFile(file, (await readFile(file, "utf8")) + "\n## Added in VS Code\n\nOutside line one.\n");
  await expect(page.getByText("Outside line one.")).toBeVisible({ timeout: 4000 });

  // 2. With a draft: the draft stays, Nexus says the file changed.
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: /Markdown for/ });
  const draft = (await editor.inputValue()) + "\nMy unsaved paragraph.\n";
  await editor.fill(draft);
  await writeFile(file, (await readFile(file, "utf8")) + "\nOutside line two.\n");
  await expect(page.getByTestId("disk-changed")).toBeVisible({ timeout: 4000 });
  await expect(editor).toHaveValue(draft);

  // Compare, then keep mine: the file gets the draft (the outside line is knowingly overwritten).
  await page.getByRole("button", { name: "Compare and choose" }).click();
  await page.getByRole("button", { name: "Overwrite with mine" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readFile(file, "utf8")).toBe(draft);

  // 3. Deleted outside while a draft is open: the text is kept and can recreate the note.
  const draft2 = draft + "\nSecond draft.\n";
  await editor.fill(draft2);
  await unlink(file);
  await expect(page.getByTestId("deleted-outside")).toBeVisible({ timeout: 4000 });
  await expect(editor).toHaveValue(draft2);
  await page.getByRole("button", { name: "Recreate with my text" }).click();
  await expect.poll(async () => readFile(file, "utf8").catch(() => null), { timeout: 4000 }).toBe(draft2);
});
