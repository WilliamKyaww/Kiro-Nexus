// Run 6, stage 4: backlinks and [[ completion (.kiro/specs/backlinks-completion), in Edge with
// AI off, in two fictional workspaces, with edits outside Nexus and a restart.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

const KICKOFF = "meetings/2026-11-24 kickoff.md";
const SCRIPT = "planning/demo script.md";
let base: string;
let svc: Service | null = null;
test.beforeEach(async () => { base = await tempDir("nexus-b2-links-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }).catch(() => undefined); });

const panel = (page: Page) => page.getByRole("region", { name: "Backlinks" });
const editor = (page: Page) => page.getByRole("textbox", { name: /Markdown for/ });
const suggestions = (page: Page) => page.getByRole("listbox");
const put = async (ws: string, rel: string, text: string) => {
  await mkdir(join(ws, ...rel.split("/").slice(0, -1)), { recursive: true });
  await writeFile(join(ws, ...rel.split("/")), text);
};
async function openNote(page: Page, rel: string) {
  await page.goto(`http://127.0.0.1:${svc!.port}/notes?path=${encodeURIComponent(rel)}`);
  await expect(page.locator("#note-title")).toHaveText(rel);
}
async function start(): Promise<{ ws: string; profile: string; page?: never }> {
  const ws = join(base, "ws");
  const profile = join(base, "profile");
  svc = await startService(profile, ws, ["--init-sample"]);
  return { ws, profile };
}
const SCRIPT_TEXT = [
  "# Demo script",
  "",
  "## Steps",
  "",
  "- [ ] Open [[2026-11-24 kickoff#Actions|the kickoff actions]] and tick one.",
  "- Show the review bar.",
  "",
  "## Later",
  "",
  "Read [[2026-11-24 kickoff#Next steps]] once it exists.",
  "",
].join("\n");

test("backlinks show each passage, open it, follow edits outside Nexus and a restart, and stay in their workspace", async ({ page, browser }) => {
  const { ws, profile } = await start();
  await page.goto(await launchUrl(svc!));
  await expect(page.getByText("AI is off", { exact: true })).toBeVisible();
  const api = await apiSession(svc!);
  expect((await api("POST", "/notes", { path: SCRIPT, content: SCRIPT_TEXT })).status).toBe(201);

  await openNote(page, KICKOFF);
  const items = panel(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("demo script › Steps");
  await expect(items.nth(0)).toContainText("Open the kickoff actions and tick one.");
  await expect(items.nth(1)).toContainText("demo script › Later");
  await expect(items.nth(1)).toContainText("It asks for the heading “Next steps”, which this note does not have.");

  // A backlink opens the source at its passage, focused and marked.
  await items.nth(0).getByRole("link").click();
  await expect(page).toHaveURL(/path=planning%2Fdemo%20script\.md&line=4/);
  const passage = page.locator(".line-target");
  await expect(passage).toHaveCount(1);
  await expect(passage).toContainText("the kickoff actions");
  await expect(passage).toContainText("Linked passage");
  await expect(passage).toBeFocused();

  // An edit outside Nexus shows up on the open note's panel within seconds.
  await openNote(page, KICKOFF);
  await put(ws, "ideas/graph.md", "# Graph\n\nSee [[2026-11-24 kickoff]] for where it started.\n");
  await expect(items).toHaveCount(3, { timeout: 5000 });
  await expect(panel(page)).toContainText("See 2026-11-24 kickoff for where it started.");
  await put(ws, "ideas/graph.md", "# Graph\n\nNo link here any more.\n");
  await expect(items).toHaveCount(2, { timeout: 5000 });

  // The same after a restart.
  await svc!.stop();
  svc = await startService(profile);
  const page2 = await (await browser.newContext()).newPage();
  await page2.goto(await launchUrl(svc));
  await page2.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent(KICKOFF)}`);
  await expect(panel(page2).getByRole("listitem")).toHaveCount(2);

  // A second fictional workspace has its own links only.
  const second = join(base, "second");
  await cp(join(process.cwd(), "samples", "meeting-workspace"), second, { recursive: true });
  await put(second, "Index.md", "# Index\n\n- [[2026-11-24 kickoff|The kickoff]]\n");
  const api2 = await apiSession(svc);
  expect((await api2("POST", "/workspace/open", { path: second })).status).toBe(200);
  await page2.goto(`http://127.0.0.1:${svc.port}/notes?path=${encodeURIComponent(KICKOFF)}`);
  const own = panel(page2).getByRole("listitem");
  await expect(own).toHaveCount(1);
  await expect(own).toContainText("Index");
  await expect(own).toContainText("The kickoff");
  await expect(panel(page2)).not.toContainText("demo script");
});

test("a shared name is ambiguous in the preview and the panel, and completion writes the path", async ({ page }) => {
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, "meetings/notes.md", "# Meeting notes\n");
  await put(ws, "planning/notes.md", "# Planning notes\n");
  await put(ws, "ideas/graph.md", "# Graph\n\nCompare [[notes]] with the board.\n");

  await openNote(page, "ideas/graph.md");
  const ambiguous = page.locator(".ambiguous-link");
  await expect(ambiguous).toContainText("notes (ambiguous link)");
  await expect(ambiguous).toHaveAttribute("title", /Several notes are called “notes”: meetings\/notes, planning\/notes/);
  await expect(ambiguous.getByRole("link")).toHaveCount(0);

  await openNote(page, "meetings/notes.md");
  await expect(panel(page)).toContainText("Ambiguous: notes has the same name, so the link may mean that note.");

  // Completion shows both folders and inserts the one chosen as a path.
  await openNote(page, "ideas/graph.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor(page).press("Control+End");
  await page.keyboard.type("Also [[notes");
  const options = suggestions(page).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("meetings");
  await expect(options.nth(1)).toContainText("planning");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveValue(/Also \[\[planning\/notes\]\]$/);
  await expect(suggestions(page)).toHaveCount(0);
});

test("evidence: the panel and the suggestions in both themes, at desktop and 390 px", async ({ page }) => {
  const shots = process.env.NEXUS_B2_SHOTS ?? "";
  test.skip(!shots, "set NEXUS_B2_SHOTS to a folder to capture the screenshots");
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, SCRIPT, SCRIPT_TEXT);
  for (const [w, h, size] of [[1360, 900, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await openNote(page, KICKOFF);
      await panel(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots, `${size}-${theme}-backlinks.png`) });
      await openNote(page, SCRIPT);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await editor(page).press("Control+End");
      await page.keyboard.type("Ask [[2026-11-24 kickoff#");
      await expect(suggestions(page)).toBeVisible();
      await page.screenshot({ path: join(shots, `${size}-${theme}-completion.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(await launchUrl(svc!));
    }
  }
});

// R6-13: the backlink names a line of the saved file, and the preview shows the unsaved draft.
test("a backlink marks its passage in an unsaved draft, or says it cannot and offers the saved version", async ({ page }) => {
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, SCRIPT, SCRIPT_TEXT);
  const lines = SCRIPT_TEXT.split("\n");
  await openNote(page, SCRIPT);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor(page).fill([...lines.slice(0, 4), "Wrong draft paragraph.", "", ...lines.slice(4)].join("\n"));
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();

  await openNote(page, KICKOFF);
  await panel(page).getByRole("listitem").nth(0).getByRole("link").click();
  await expect(page).toHaveURL(/line=4/);
  const passage = page.locator(".line-target");
  await expect(page.locator(".preview")).toContainText("Wrong draft paragraph.");
  await expect(passage).toHaveCount(1);
  await expect(passage).toContainText("the kickoff actions");
  await expect(passage).toContainText("Linked passage");
  await expect(passage).toBeFocused();

  // The draft changes the link itself: nothing is marked, and the saved version is one choice away.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor(page).fill(SCRIPT_TEXT.replace("the kickoff actions", "the actions we agreed"));
  await openNote(page, KICKOFF);
  await panel(page).getByRole("listitem").nth(0).getByRole("link").click();
  await expect(page.getByTestId("passage-uncertain")).toContainText("Your unsaved draft of this note differs from the saved version");
  await expect(page.locator(".preview")).toContainText("the actions we agreed");
  await expect(passage).toHaveCount(0);
  await page.getByRole("button", { name: "Show the saved version" }).click();
  await expect(passage).toHaveCount(1);
  await expect(passage).toContainText("the kickoff actions");
  await expect(passage).toBeFocused();
  await expect(page.getByTestId("passage-saved")).toContainText("This is the saved version");
  await page.getByRole("button", { name: "Back to my draft" }).click();
  await expect(page.locator(".preview")).toContainText("the actions we agreed");
  await expect(passage).toHaveCount(0);
  expect(await readFile(join(ws, ...SCRIPT.split("/")), "utf8")).toBe(SCRIPT_TEXT);
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
});

// R6-14: two headings with the same text.
test("completion tells repeated headings apart, and the link it writes opens the one chosen", async ({ page }) => {
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, "Target.md", ["# Target", "", "## Tasks", "", "Order lunch for the team.", "", "## Tasks", "", "Deliver the parcels.", ""].join("\n"));
  await put(ws, "Source.md", "# Source\n\n");
  await openNote(page, "Source.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor(page).press("Control+End");
  await page.keyboard.type("See [[Target#Tas");
  const options = page.getByRole("listbox", { name: "Headings in Target" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveValue(/See \[\[Target#tasks-1\]\]$/);

  // The two are told apart on screen by their first lines.
  await page.keyboard.type("\nAnd [[Target#Tas");
  await expect(options.nth(0)).toContainText("Order lunch for the team.");
  await expect(options.nth(1)).toContainText("Deliver the parcels.");
  await page.keyboard.press("Escape");
  await editor(page).fill("# Source\n\nSee [[Target#tasks-1]]\n");
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator(".preview").getByRole("link", { name: "Target › tasks-1" }).click();
  await expect(page).toHaveURL(/path=Target\.md&heading=tasks-1/);
  await expect(page.locator("#h-tasks-1")).toHaveClass(/heading-target/);
  await expect(page.locator("#h-tasks-1")).toBeFocused();
  await expect(page.locator("#h-tasks")).not.toHaveClass(/heading-target/);
  const item = panel(page).getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Source");
  await expect(item).not.toContainText("does not have");
});

// R6-15: eight suggestions on a 390 × 844 screen.
test("at 390 px the chosen suggestion stays in view, and near the bottom the list opens above the caret", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  for (let i = 1; i <= 8; i++) await put(ws, `demos/Demo0${i}.md`, `# Demo 0${i}\n`);
  await put(ws, "Short.md", "# Short\n\n");
  await put(ws, "Long.md", ["# Long", "", ...Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the long note.`), ""].join("\n"));
  const list = page.locator(".link-suggest");
  const options = suggestions(page).getByRole("option");
  const inView = async (i: number) => {
    const box = editor(page);
    await expect(options.nth(i)).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveAttribute("aria-activedescendant", (await options.nth(i).getAttribute("id"))!);
    const [o, l, b] = [await options.nth(i).boundingBox(), await list.boundingBox(), await box.boundingBox()];
    const bottom = Math.min(b!.y + b!.height, 844);
    expect(o!.y, `option ${i} starts inside the list`).toBeGreaterThanOrEqual(l!.y - 0.5);
    expect(o!.y + o!.height, `option ${i} ends inside the list`).toBeLessThanOrEqual(l!.y + l!.height + 0.5);
    expect(l!.y + l!.height, "the list ends inside the editor and the screen").toBeLessThanOrEqual(bottom + 0.5);
    expect(l!.y, "the list starts inside the editor and the screen").toBeGreaterThanOrEqual(Math.max(b!.y, 0) - 0.5);
  };

  for (const note of ["Short.md", "Long.md"]) {
    await openNote(page, note);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await editor(page).press("Control+End");
    await page.keyboard.type("[[Demo");
    await expect(options).toHaveCount(8);
    await inView(0);
    for (let i = 1; i < 8; i++) { await page.keyboard.press("ArrowDown"); await inView(i); }
    await page.keyboard.press("ArrowDown");
    await inView(0);
    await page.keyboard.press("ArrowUp");
    await inView(7);
    if (process.env.NEXUS_B2_SHOTS) await page.screenshot({ path: join(process.env.NEXUS_B2_SHOTS, `mobile-suggest-${note.replace(".md", "").toLowerCase()}.png`) });
    await page.keyboard.press("Enter");
    await expect(editor(page)).toHaveValue(/\[\[Demo08\]\]$/);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
  }
});

// R6-16: a four-space-indented literal is code in the preview, so it is not a link.
test("a link written in indented code is not a backlink, as the preview shows it as code", async ({ page }) => {
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, "Target.md", "# Target\n");
  await put(ws, "Source.md", ["# Source", "", "See [[Target]] for the plan.", "", "    [[Target]] is how a link is written.", ""].join("\n"));
  await openNote(page, "Source.md");
  await expect(page.locator(".preview pre code")).toContainText("[[Target]] is how a link is written.");
  await expect(page.locator(".preview").getByRole("link", { name: "Target" })).toHaveCount(1);
  await openNote(page, "Target.md");
  const items = panel(page).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("See Target for the plan.");

  // Completion is not offered inside code either.
  await openNote(page, "Source.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor(page).press("Control+End");
  await page.keyboard.type("\n    [[Tar");
  await expect(page.locator(".link-suggest")).toHaveCount(0);
  await page.keyboard.type("\n\nOutside code [[Tar");
  await expect(suggestions(page).getByRole("option").first()).toContainText("Target");
});

test("completion by keyboard: notes, headings, an alias kept, Escape, Undo, and the draft stays unsaved", async ({ page }) => {
  const { ws } = await start();
  await page.goto(await launchUrl(svc!));
  await put(ws, SCRIPT, SCRIPT_TEXT);
  await openNote(page, SCRIPT);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = editor(page);
  await box.press("Control+End");

  // A note: [[ then a few letters, Enter inserts and closes the link.
  await page.keyboard.type("Ask [[kick");
  await expect(box).toHaveAttribute("aria-autocomplete", "list");
  const first = suggestions(page).getByRole("option").first();
  await expect(first).toContainText("2026-11-24 kickoff");
  await expect(box).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue(/Ask \[\[2026-11-24 kickoff\]\]$/);
  // Undo brings back what was typed.
  await page.keyboard.press("Control+Z");
  await expect(box).toHaveValue(/Ask \[\[kick$/);
  await page.keyboard.press("Control+Y");
  await expect(box).toHaveValue(/Ask \[\[2026-11-24 kickoff\]\]$/);

  // A heading of that note, inserted with Tab.
  await page.keyboard.type("\nThen [[2026-11-24 kickoff#Ac");
  await expect(page.getByRole("listbox", { name: "Headings in 2026-11-24 kickoff" }).getByRole("option")).toHaveText(["Actions"]);
  await page.keyboard.press("Tab");
  await expect(box).toHaveValue(/Then \[\[2026-11-24 kickoff#Actions\]\]$/);

  // Nothing is offered for a name that does not exist; Escape closes the list and changes nothing.
  await page.keyboard.type("\n[[Nowhere#");
  await expect(page.locator(".link-suggest-status")).toHaveText("No note is called “Nowhere”.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".link-suggest")).toHaveCount(0);
  await expect(box).toHaveValue(/\n\[\[Nowhere#$/);

  // Completing the name of an existing link keeps its alias and the text after it.
  const text = await box.inputValue();
  await box.fill(`${text}\nSee [[kick|my alias]] now.`);
  const at = (await box.inputValue()).indexOf("kick|my alias") + "kick".length;
  await box.evaluate((el: HTMLTextAreaElement, pos) => { el.focus(); el.setSelectionRange(pos, pos); }, at);
  await page.keyboard.type("o");
  await expect(suggestions(page).getByRole("option").first()).toContainText("2026-11-24 kickoff");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue(/See \[\[2026-11-24 kickoff\|my alias\]\] now\.$/);

  // It is all an ordinary unsaved draft: kept across navigation, not on disk until saved.
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  const draft = await box.inputValue();
  expect(await readFile(join(ws, ...SCRIPT.split("/")), "utf8")).toBe(SCRIPT_TEXT);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Projects", exact: true }).click();
  await openNote(page, SCRIPT);
  await expect(box).toHaveValue(draft);
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readFile(join(ws, ...SCRIPT.split("/")), "utf8")).toBe(draft);

  // Saved, the new links are backlinks of the kickoff note.
  await openNote(page, KICKOFF);
  await expect(panel(page).getByRole("listitem")).toHaveCount(5);
  await expect(panel(page)).toContainText("See my alias now.");
});
