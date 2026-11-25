// Run 6, stage 2: light and dark appearance in the working app (.kiro/specs/appearance).
// Browser route in Edge with AI off, a fictional sample workspace and an isolated profile.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { apiSession, launchUrl, startService, tempDir, thumbFailures, type Service } from "./support";

let base: string;
let svc: Service | null = null;
const SHOTS = process.env.NEXUS_APPEARANCE_SHOTS ?? "";
test.beforeEach(async () => {
  base = await tempDir("nexus-appearance-");
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

const html = (page: Page) => page.locator("html");
const switchOf = (page: Page) => page.getByRole("switch", { name: "Dark mode" });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();
const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });
async function open(page: Page) {
  await page.goto(await launchUrl(svc!));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}
// Null until the first save writes the file: expect.poll fails at once if this throws, rather
// than polling again, so a fresh profile under load must not throw.
const stored = async () => {
  try { return JSON.parse(await readFile(join(base, "profile", "appearance.json"), "utf8")); } catch { return null; }
};

test("a fresh profile matches the system, and the quick switch picks the opposite explicitly, by keyboard, keeping focus", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await expect(html(page)).toHaveAttribute("data-mode", "system");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(html(page)).toHaveAttribute("data-palette", "graphite");
  await expect(switchOf(page)).toHaveAttribute("aria-checked", "true");
  await switchOf(page).focus();
  await page.keyboard.press("Space");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(html(page)).toHaveAttribute("data-mode", "light");
  await expect(switchOf(page)).toHaveAttribute("aria-checked", "false");
  await expect(switchOf(page)).toBeFocused();
  await expect(switchOf(page)).toContainText("Off");
  await expect.poll(stored).toMatchObject({ mode: "light", light: "porcelain", dark: "graphite" });
  for (const section of ["Notes", "Projects", "Calendar", "Notifications", "Settings"]) {
    await nav(page, section);
    await expect(switchOf(page), section).toBeVisible();
  }
  await page.keyboard.press("Tab"); // focus can leave and come back; the switch stays a single control
  await switchOf(page).press("Enter");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
});

test("at 390 px the switch is reachable and works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await switchOf(page).scrollIntoViewIfNeeded();
  await expect(switchOf(page)).toBeInViewport();
  await switchOf(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(switchOf(page)).toBeFocused();
});

test("at desktop width the switch fits on one line and stays in view at the bottom of a long page", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page);
  await page.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const label = switchOf(page).locator(".theme-switch-label");
  // One line of text is well under two font sizes tall; a wrapped label is over two.
  const ratio = await label.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize));
  expect(ratio).toBeLessThan(2);
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(switchOf(page)).toBeInViewport();
});

test("Match system follows the system setting while it is selected, with no reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await nav(page, "Settings");
  const mode = page.getByRole("group", { name: "Mode" });
  await mode.getByRole("radio", { name: /Dark/ }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await mode.getByRole("radio", { name: /Match system/ }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("appearance-now")).toContainText("Showing the dark theme, as your computer is set to");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});

test("the palettes are remembered for each theme across a reload, a restart on another port and a workspace switch, from the first paint", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await nav(page, "Settings");
  await page.getByRole("group", { name: "Light palette" }).locator(".palette-card").filter({ hasText: "Mist" }).click();
  await expect(html(page)).toHaveAttribute("data-palette", "mist");
  await page.getByRole("group", { name: "Dark palette" }).locator(".palette-card").filter({ hasText: "Plum" }).click();
  await expect(html(page)).toHaveAttribute("data-palette", "mist"); // still light: the dark choice is remembered for later
  await page.getByRole("group", { name: "Mode" }).getByRole("radio", { name: /Dark/ }).check();
  await expect(html(page)).toHaveAttribute("data-palette", "plum");
  await expect.poll(stored).toEqual({ schemaVersion: 1, mode: "dark", light: "mist", dark: "plum" });
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-palette", "plum");

  const oldPort = svc!.port;
  await svc!.stop();
  svc = await startService(join(base, "profile"), join(base, "ws"));
  // The app shell carries the preference, so the theme is set before anything paints.
  const shell = await (await fetch(`http://127.0.0.1:${svc.port}/`)).text();
  expect(shell).toContain('data-mode="dark" data-light="mist" data-dark="plum"');
  const page2 = await page.context().newPage();
  await page2.goto(await launchUrl(svc), { waitUntil: "domcontentloaded" });
  await expect(html(page2)).toHaveAttribute("data-theme", "dark");
  await expect(html(page2)).toHaveAttribute("data-palette", "plum");
  await switchOf(page2).click();
  await expect(html(page2)).toHaveAttribute("data-palette", "mist");
  test.info().annotations.push({ type: "ports", description: `${oldPort} then ${svc.port}` });

  // Switching to another workspace keeps the profile's choice.
  const { cp } = await import("node:fs/promises");
  const second = join(base, "ws-second");
  await cp(join(process.cwd(), "samples", "meeting-workspace"), second, { recursive: true });
  const api = await apiSession(svc);
  expect((await api("POST", "/workspace/open", { path: second })).status).toBe(200);
  await page2.reload();
  await expect(page2.getByRole("navigation", { name: "Sections" })).toContainText("Workspace");
  await expect(html(page2)).toHaveAttribute("data-theme", "light");
  await expect(html(page2)).toHaveAttribute("data-palette", "mist");
});

test("switching keeps a note draft and the position in a review", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  await expect(bar(page)).toContainText("Change 1 of");
  await expect(page).toHaveURL(/change=/); // the demo opens its first change first
  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(bar(page)).toContainText("Change 2 of");
  await switchOf(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(bar(page)).toContainText("Change 2 of");
  await nav(page, "Notes");
  await page.getByRole("link", { name: /2026-11-24 kickoff/ }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: /Markdown for/ });
  await editor.fill("# Draft kept across a theme switch\n");
  await switchOf(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(editor).toHaveValue("# Draft kept across a theme switch\n");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
});

test("two sessions choosing palettes at the same time both keep their choice, and neither flicks back (R6-12)", async ({ page, browser }) => {
  const card = (p: Page, group: string, name: string) => p.getByRole("group", { name: group }).locator(".palette-card").filter({ hasText: name });
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await nav(page, "Settings");
  const otherContext = await browser.newContext(); // session B: a separate browser session on the same profile
  const pageB = await otherContext.newPage();
  try {
    await pageB.emulateMedia({ colorScheme: "light" });
    await open(pageB);
    await nav(pageB, "Settings");
    // Record each palette pair session A shows from now on.
    await page.evaluate(() => {
      const w = window as unknown as { __shown: string[] };
      w.__shown = [];
      const root = document.documentElement;
      new MutationObserver(() => w.__shown.push(`${root.getAttribute("data-light")}/${root.getAttribute("data-dark")}`)).observe(root, { attributes: true, attributeFilter: ["data-light", "data-dark"] });
    });
    // A's save is held until B's save has finished.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let reached!: () => void;
    const saving = new Promise<void>((r) => { reached = r; });
    await page.route("**/api/v1/appearance", async (route) => {
      if (route.request().method() === "GET") return route.continue();
      reached();
      await held;
      await route.continue();
    });
    await card(page, "Light palette", "Linen").click(); // A: Linen for light, slow to save
    await saving;
    await card(pageB, "Dark palette", "Plum").click(); // B: Plum for dark, meanwhile
    await expect.poll(stored).toMatchObject({ dark: "plum" });
    await expect(html(page)).toHaveAttribute("data-dark", "plum"); // B's choice reaches A while A's save is held
    release();
    const both = { schemaVersion: 1, mode: "system", light: "linen", dark: "plum" };
    await expect.poll(stored).toEqual(both);
    for (const [name, p] of [["A", page], ["B", pageB]] as const) {
      await expect(html(p), name).toHaveAttribute("data-light", "linen");
      await expect(html(p), name).toHaveAttribute("data-dark", "plum");
      await expect(html(p), name).toHaveAttribute("data-palette", "linen");
      await expect(card(p, "Light palette", "Linen").getByRole("radio"), name).toBeChecked();
      await expect(card(p, "Dark palette", "Plum").getByRole("radio"), name).toBeChecked();
    }
    // A never went back to Porcelain, and once it showed Plum it never went back to Graphite.
    const shown = await page.evaluate(() => (window as unknown as { __shown: string[] }).__shown);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((s) => !s.startsWith("linen/")), shown.join(", ")).toEqual([]);
    expect(shown.slice(shown.indexOf("linen/plum")).filter((s) => s !== "linen/plum"), shown.join(", ")).toEqual([]);
    await pageB.reload();
    await expect(html(pageB)).toHaveAttribute("data-palette", "linen");
    await expect(html(pageB)).toHaveAttribute("data-dark", "plum");
  } finally {
    await otherContext.close();
  }
});

test("every palette can be chosen, says Selected in words, and meets the contrast targets", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await nav(page, "Settings");
  for (const [group, names] of [["Light palette", ["Linen", "Mist", "Porcelain"]], ["Dark palette", ["Midnight", "Plum", "Graphite"]]] as const) {
    for (const name of names) {
      const card = page.getByRole("group", { name: group }).locator(".palette-card").filter({ hasText: name });
      await card.click();
      await expect(card.getByRole("radio")).toBeChecked();
      await expect(card).toHaveAttribute("data-selected", "true");
      await expect(card.locator(".palette-selected")).toHaveText("Selected");
    }
  }
  const pairs: Array<[string, string, number]> = [
    ...["canvas", "rail", "surface", "raised", "sunk", "hover"].flatMap((bg) => ["ink", "ink-2", "ink-3"].map((fg) => [fg, bg, 4.5] as [string, string, number])),
    ["accent-ink", "surface", 4.5], ["accent-ink", "accent-soft", 4.5], ["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5], ["pend", "pend-soft", 4.5], ["ok", "ok-soft", 4.5], ["bad", "bad-soft", 4.5],
    ["ink", "selection", 4.5], ["control-line", "surface", 3], ["control-line", "raised", 3], ["focus", "surface", 3], ["focus", "canvas", 3],
  ];
  const failures = await page.evaluate((list) => {
    // A canvas resolves any CSS colour, including color-mix(), to its sRGB bytes.
    const probe = document.createElement("canvas").getContext("2d")!;
    const rgb = (v: string) => { if (!v.trim()) return null; probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = v.trim(); probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0]! / 255, d[1]! / 255, d[2]! / 255]; };
    const lum = (c: number[]) => { const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
    const out: string[] = [];
    for (const [theme, palette] of [["light", "porcelain"], ["light", "linen"], ["light", "mist"], ["dark", "graphite"], ["dark", "midnight"], ["dark", "plum"]]) {
      const el = document.createElement("div");
      el.setAttribute("data-theme", theme!); el.setAttribute("data-palette", palette!);
      document.body.append(el);
      const s = getComputedStyle(el);
      for (const [fg, bg, min] of list) {
        const a = rgb(s.getPropertyValue(`--${fg}`)); const b = rgb(s.getPropertyValue(`--${bg}`));
        if (!a || !b) { out.push(`${palette}: --${fg} or --${bg} is not a colour`); continue; }
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
        const ratio = (x! + 0.05) / (y! + 0.05);
        if (ratio < min) out.push(`${palette}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
      el.remove();
    }
    return out;
  }, pairs);
  expect(failures).toEqual([]);
  // Focus is visible on the switch in the dark theme too.
  await page.getByRole("group", { name: "Mode" }).getByRole("radio", { name: /Dark/ }).check();
  await switchOf(page).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const outline = await switchOf(page).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("the scrollbar thumb meets 3:1 against every background that scrolls, in each palette (R6-17)", async ({ page }) => {
  await open(page);
  // Every background a scrolling element has in the app: the page, the rail, cards, the link
  // suggestions and code blocks.
  const failures = await page.evaluate(thumbFailures, ["canvas", "rail", "surface", "raised", "sunk"]);
  expect(failures).toEqual([]);
});

test("evidence: screenshots of the main screens in both themes, at desktop and 390 px", async ({ page }) => {
  test.skip(!SHOTS, "set NEXUS_APPEARANCE_SHOTS to a folder to capture the screenshots");
  test.setTimeout(240_000);
  await mkdir(SHOTS, { recursive: true });
  await open(page);
  await page.getByRole("button", { name: "Apply demo changes (fixed, not AI)" }).click();
  await expect(bar(page)).toContainText("Change 1 of");
  const { cookies: _c, origins } = await page.context().storageState();
  void _c; void origins;
  for (const [w, h, size] of [[1360, 900, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`http://127.0.0.1:${svc!.port}/settings`);
      await page.getByRole("group", { name: "Mode" }).getByRole("radio", { name: /Match system/ }).check();
      await expect(html(page)).toHaveAttribute("data-theme", theme);
      const shoot = async (name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: join(SHOTS, `${size}-${theme}-${name}.png`) }); };
      await page.goto(`http://127.0.0.1:${svc!.port}/`); await shoot("home");
      await page.goto(`http://127.0.0.1:${svc!.port}/settings`); await page.locator("#appearance").scrollIntoViewIfNeeded(); await shoot("settings");
      await page.goto(`http://127.0.0.1:${svc!.port}/notes?path=${encodeURIComponent("meetings/2026-11-24 kickoff.md")}`); await shoot("note-review");
      await page.goto(`http://127.0.0.1:${svc!.port}/projects/NEX`); await shoot("board");
      await page.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1`); await shoot("issue-review");
    }
  }
});

test("Electron: the stored theme is there at the first paint, and the window opens on its canvas colour", async () => {
  const electronPath = (await import("electron")).default as unknown as string;
  const dir = join(base, "desktop");
  const ws = join(dir, "ws");
  const { cp } = await import("node:fs/promises");
  await cp(join(process.cwd(), "samples", "meeting-workspace"), ws, { recursive: true });
  await mkdir(join(dir, "profile"), { recursive: true });
  await writeFile(join(dir, "profile", "appearance.json"), JSON.stringify({ schemaVersion: 1, mode: "dark", light: "porcelain", dark: "midnight" }, null, 2) + "\n");
  const env = { ...process.env, NEXUS_PROFILE_DIR: join(dir, "profile"), NEXUS_WORKSPACE: ws } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath, args: [resolve("apps/desktop/dist/main.cjs")], env, timeout: 60_000 });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(win.locator("html")).toHaveAttribute("data-palette", "midnight");
    const background = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor());
    expect(background.toLowerCase()).toBe("#0a0f17");
    await expect(win.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
    // The quick switch in the desktop app writes the same profile file.
    await win.getByRole("switch", { name: "Dark mode" }).click();
    await expect(win.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(async () => JSON.parse(await readFile(join(dir, "profile", "appearance.json"), "utf8"))).toMatchObject({ mode: "light", dark: "midnight" });
  } finally {
    await app.close();
  }
  // A relaunch opens light from the first paint, on the light canvas.
  const again = await electron.launch({ executablePath: electronPath, args: [resolve("apps/desktop/dist/main.cjs")], env, timeout: 60_000 });
  try {
    const win = await again.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(win.locator("html")).toHaveAttribute("data-palette", "porcelain");
    const background = await again.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor());
    expect(background.toLowerCase()).toBe("#f2f2f5");
  } finally {
    await again.close();
  }
});

test("Electron: a stored preference of null falls back to the default, and the app opens on the matching canvas (R6-11)", async () => {
  const electronPath = (await import("electron")).default as unknown as string;
  const dir = join(base, "desktop-invalid");
  const ws = join(dir, "ws");
  const { cp } = await import("node:fs/promises");
  await cp(join(process.cwd(), "samples", "meeting-workspace"), ws, { recursive: true });
  await mkdir(join(dir, "profile"), { recursive: true });
  await writeFile(join(dir, "profile", "appearance.json"), "null");
  const env = { ...process.env, NEXUS_PROFILE_DIR: join(dir, "profile"), NEXUS_WORKSPACE: ws } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath, args: [resolve("apps/desktop/dist/main.cjs")], env, timeout: 60_000 });
  // A start-up failure is recorded instead of shown: a modal error box would leave the test waiting.
  const failures: string[] = [];
  app.process().stderr?.on("data", (d: Buffer) => {
    for (const line of String(d).split(/\r?\n/)) if (line.startsWith("NEXUS_START_FAILURE ")) failures.push(line.slice("NEXUS_START_FAILURE ".length));
  });
  await app.evaluate(({ dialog }) => {
    dialog.showErrorBox = (title: string, content: string) => { process.stderr.write(`NEXUS_START_FAILURE ${title}: ${content}\n`); };
  });
  try {
    const win = await app.firstWindow().catch((e: Error) => { throw new Error(`The desktop app did not open a window. ${failures.join(" | ") || e.message}`); });
    await win.waitForLoadState("domcontentloaded");
    await expect(win.getByRole("switch", { name: "Dark mode" })).toBeVisible();
    // The default is Match system: the page follows the scheme it sees, main the native one.
    const pageDark = await win.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
    const nativeDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(win.locator("html")).toHaveAttribute("data-mode", "system");
    await expect(win.locator("html")).toHaveAttribute("data-theme", pageDark ? "dark" : "light");
    await expect(win.locator("html")).toHaveAttribute("data-palette", pageDark ? "graphite" : "porcelain");
    const background = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor());
    expect(background.toLowerCase()).toBe(nativeDark ? "#0e0f11" : "#f2f2f5");
    // The next choice replaces the invalid file with a valid preference.
    await win.getByRole("switch", { name: "Dark mode" }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(dir, "profile", "appearance.json"), "utf8")))
      .toEqual({ schemaVersion: 1, mode: pageDark ? "light" : "dark", light: "porcelain", dark: "graphite" });
    expect(failures).toEqual([]);
  } finally {
    await app.close().catch(() => { app.process().kill(); });
  }
});