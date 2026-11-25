// Run 6, stage 2: light and dark appearance in the wireframe (.kiro/specs/appearance, task 5).
// Serves wireframe/ on loopback; the wireframe keeps its preference in localStorage.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, test, type Page } from "@playwright/test";

let server: ChildProcess;
let base: string;
test.beforeAll(async () => {
  server = spawn(process.execPath, ["scripts/serve-static.mjs", "wireframe", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<number>((resolve, reject) => {
    createInterface({ input: server.stdout! }).on("line", (line) => { try { const m = JSON.parse(line); if (m.event === "ready") resolve(m.port); } catch { /* not JSON */ } });
    server.once("exit", (code) => reject(new Error(`static server exited ${code}`)));
  });
  base = `http://127.0.0.1:${port}/index.html`;
});
test.afterAll(() => { server.kill(); });

const look = (page: Page) => page.evaluate(() => `${document.documentElement.dataset.theme}/${document.documentElement.dataset.palette}`);
const switchOf = (page: Page) => page.getByRole("switch", { name: "Dark mode" });

test("the wireframe follows the system first, and the switch, the palettes and Match system work and persist", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(base + "#/home");
  expect(await look(page)).toBe("dark/graphite");
  await expect(switchOf(page)).toHaveAttribute("aria-checked", "true");
  await switchOf(page).focus();
  await page.keyboard.press("Space");
  expect(await look(page)).toBe("light/porcelain");
  await expect(switchOf(page)).toBeFocused();
  await expect(switchOf(page)).toHaveAttribute("aria-checked", "false");

  await page.goto(base + "#/settings");
  await page.locator('.ap-group[data-ap-theme="light"] .ap-card').filter({ hasText: "Linen" }).click();
  expect(await look(page)).toBe("light/linen");
  await page.locator('.ap-group[data-ap-theme="dark"] .ap-card').filter({ hasText: "Plum" }).click();
  expect(await look(page)).toBe("light/linen"); // the dark choice waits for the dark theme
  await page.getByRole("radio", { name: /Match system/ }).check();
  await expect.poll(() => look(page)).toBe("dark/plum");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => look(page)).toBe("light/linen");
  await page.reload();
  expect(await look(page)).toBe("light/linen"); // set by theme-boot.js before the first paint
  await expect(page.locator('.ap-card[data-selected="true"] .ap-name')).toHaveText(["Linen", "Plum"]);
  await expect(page.locator('.ap-card[data-selected="true"] .ap-selected')).toHaveText(["Selected", "Selected"]);

  // <html> now carries data-palette, so only the search button opens the command palette.
  await page.locator("#set-h").click();
  await expect(page.locator("dialog.palette[open]")).toHaveCount(0);
  await page.locator(".search").click();
  await expect(page.locator("dialog.palette[open]")).toHaveCount(1);
});

test("at 390 px the wireframe switch is in the top bar with its name, and works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(base + "#/board");
  await expect(switchOf(page)).toBeInViewport();
  await switchOf(page).click();
  expect(await look(page)).toBe("dark/graphite");
  await expect(switchOf(page)).toBeFocused();
});

test("the review demo still works in the dark theme, and every wireframe palette meets the contrast targets", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(base + "#/home");
  await page.getByRole("button", { name: /Apply fixed demo changes/ }).click();
  const bar = page.getByRole("region", { name: "Changes awaiting review" });
  await expect(bar).toContainText("Change 1 of 2");
  await bar.getByRole("button", { name: "Next" }).click();
  await expect(bar).toContainText("Change 2 of 2");
  await switchOf(page).click();
  await expect(bar).toContainText("Change 2 of 2"); // the position survives a switch

  const pairs: Array<[string, string, number]> = [
    ...["shell", "panel", "raised", "sunk", "hover"].flatMap((bg) => ["ink", "ink-2", "ink-3"].map((fg) => [fg, bg, 4.5] as [string, string, number])),
    ["doc-ink", "panel", 4.5], ["out-day", "panel", 4.5], ["accent-ink", "panel", 4.5], ["accent-ink", "accent-soft", 4.5], ["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5],
    ["pend", "pend-soft", 4.5], ["pend", "panel", 4.5], ["ok", "panel", 4.5], ["bad", "panel", 4.5], ["ink", "selection", 4.5], ["on-inverse", "inverse", 4.5],
    ["rb-ink", "rb-bg", 4.5], ["rb-ink-2", "rb-bg", 4.5], ["rb-ink-3", "rb-bg", 4.5], ["rb-ink", "rb-btn", 4.5], ["rb-on-accept", "rb-accept", 4.5], ["rb-on-accept", "rb-accept-hover", 4.5],
    ["rb-pend", "rb-pend-bg", 4.5], ["rb-ok", "rb-ok-bg", 4.5], ["rb-bad", "rb-bad-bg", 4.5],
    ["control-line", "raised", 3], ["control-line", "panel", 3], ["focus", "panel", 3], ["focus", "shell", 3], ["rb-focus", "rb-bg", 3], ["rb-input-line", "rb-input", 3],
    ["on-pend", "pend", 3], ["accent-icon", "raised", 3], ["st-todo", "raised", 3], ["st-progress", "raised", 3], ["st-done", "raised", 3], ["teal", "panel", 3], ["urgent", "raised", 3],
  ];
  const failures = await page.evaluate((list) => {
    const probe = document.createElement("canvas").getContext("2d")!;
    const rgb = (v: string) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = v.trim(); probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0]! / 255, d[1]! / 255, d[2]! / 255]; };
    const lum = (c: number[]) => { const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
    const out: string[] = [];
    for (const [theme, palette] of [["light", "porcelain"], ["light", "linen"], ["light", "mist"], ["dark", "graphite"], ["dark", "midnight"], ["dark", "plum"]]) {
      const el = document.createElement("div");
      el.dataset.theme = theme!; el.dataset.palette = palette!;
      document.body.append(el);
      const s = getComputedStyle(el);
      for (const [fg, bg, min] of list) {
        const a = s.getPropertyValue(`--${fg}`); const b = s.getPropertyValue(`--${bg}`);
        if (!a.trim() || !b.trim()) { out.push(`${palette}: --${fg} or --${bg} is missing`); continue; }
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
        const ratio = (x! + 0.05) / (y! + 0.05);
        if (ratio < min) out.push(`${palette}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
      el.remove();
    }
    return out;
  }, pairs);
  expect(failures).toEqual([]);
});
