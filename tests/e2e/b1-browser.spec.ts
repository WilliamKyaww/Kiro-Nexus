// B1 browser smoke: fresh session, note, linked issue, both directions, stale save, restart.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let svc: Service | null = null;

test.beforeEach(async () => { base = await tempDir("nexus-e2e-"); });
test.afterEach(async () => {
  await svc?.stop();
  svc = null;
  await rm(base, { recursive: true, force: true });
});

test("a fresh tab without a launch code gets no data", async ({ page }) => {
  svc = await startService(join(base, "profile"), base);
  const apiCalls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) apiCalls.push(r.url()); });
  await page.goto(`http://127.0.0.1:${svc.port}/notes`);
  await expect(page.getByRole("heading", { name: "Open Nexus from its launcher" })).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test("note and linked issue: create, navigate both ways, protect stale saves, survive a restart", async ({ page, browser }) => {
  const profile = join(base, "profile");
  const ws = join(base, "workspace");
  await import("node:fs/promises").then((fs) => fs.mkdir(ws));
  svc = await startService(profile, ws);

  await page.goto(await launchUrl(svc));
  await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  expect(page.url()).not.toContain("launch=");
  await expect(page.getByText("AI is off")).toBeVisible();

  // Create a note with headings.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Notes" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Kickoff");
  await page.getByLabel("Folder (optional)").fill("meetings");
  await page.getByRole("button", { name: "Create note" }).click();
  const editor = page.getByRole("textbox", { name: /Markdown for meetings\/Kickoff\.md/ });
  await editor.fill("# Kickoff\n\n## Decisions\n\nOne workspace.\n\n## Actions\n\n- [ ] Write the judge instructions\n");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readFile(join(ws, "meetings", "Kickoff.md"), "utf8")).toBe("# Kickoff\n\n## Decisions\n\nOne workspace.\n\n## Actions\n\n- [ ] Write the judge instructions\n");

  // Create a project and an issue, then link the Actions heading.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Projects" }).click();
  await page.getByLabel("Key").fill("NEX");
  await page.getByLabel("Name").fill("Nexus hackathon");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("textbox", { name: "New issue" }).fill("Write the judge instructions");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Write the judge instructions" })).toBeVisible();
  await page.getByLabel("Status").selectOption("in_progress");
  await page.getByLabel("Due date").fill("2026-12-03");
  await page.getByRole("button", { name: "Save issue" }).click();
  await expect(page.getByText("Saved · revision 2")).toBeVisible();
  await page.getByTestId("link-note").selectOption("meetings/Kickoff.md");
  await page.getByTestId("link-heading").selectOption("actions");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByTestId("open-linked-note")).toHaveText("meetings/Kickoff › Actions");

  // Issue -> note heading.
  await page.getByTestId("open-linked-note").click();
  const target = page.locator(".heading-target");
  await expect(target).toContainText("Actions");
  await expect(target).toBeFocused();
  expect(page.url()).toContain("heading=actions");

  // Note -> issue via the Linked issues panel.
  await page.getByRole("complementary", { name: "About this note" }).getByRole("link", { name: /NEX-1/ }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Write the judge instructions" })).toBeVisible();

  // Stale save: the file changes on disk while the editor holds unsaved text.
  await page.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent("meetings/Kickoff.md")}`);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: /Markdown for/ }).fill("# Kickoff\n\nMy unsaved draft\n");
  await writeFile(join(ws, "meetings", "Kickoff.md"), "# Kickoff\n\nNewer text from another editor\n");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This note changed since you opened it" }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Markdown for/ })).toHaveValue("# Kickoff\n\nMy unsaved draft\n");
  expect(await readFile(join(ws, "meetings", "Kickoff.md"), "utf8")).toBe("# Kickoff\n\nNewer text from another editor\n");
  await page.getByRole("button", { name: "Load latest (discard mine)" }).click();
  await expect(page.getByRole("textbox", { name: /Markdown for/ })).toHaveValue("# Kickoff\n\nNewer text from another editor\n");
  // Restore the agreed note through the UI so the restart check has headings.
  await page.getByRole("textbox", { name: /Markdown for/ }).fill("# Kickoff\n\n## Actions\n\n- [ ] Write the judge instructions\n");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  // Restart: stop the service, start it again with the same profile, use a brand-new browser context.
  await svc.stop();
  svc = await startService(profile);
  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  await page2.goto(await launchUrl(svc));
  await page2.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Projects" }).click();
  await page2.getByRole("link", { name: /NEX Nexus hackathon/ }).click();
  await page2.getByRole("link", { name: "NEX-1" }).click();
  await expect(page2.getByLabel("Status")).toHaveValue("in_progress");
  await expect(page2.getByLabel("Due date")).toHaveValue("2026-12-03");
  await page2.getByTestId("open-linked-note").click();
  await expect(page2.locator(".heading-target")).toContainText("Actions");
  await expect(page2.getByText("Write the judge instructions").first()).toBeVisible();

  const issues = JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"));
  expect(issues.issues[0]).toMatchObject({ key: "NEX-1", status: "in_progress", due: { date: "2026-12-03" },
    noteLinks: [{ notePath: "meetings/Kickoff.md", headingSlug: "actions", headingText: "Actions" }] });
  await fresh.close();
});
