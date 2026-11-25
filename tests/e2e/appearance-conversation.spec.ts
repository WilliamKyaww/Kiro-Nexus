// Run 6, stage 2: switching the theme keeps the open conversation (.kiro/specs/appearance,
// requirement 3.4). Uses the deterministic provider double, a labelled fixture, not AI.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { launchUrl, startService, tempDir, type Service } from "./support";
test.use({ trace: "off", screenshot: "off" }); // a fake key is typed in Settings

let base: string;
let svc: Service | null = null;
let double: ProviderDouble;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => {
  base = await tempDir("nexus-appearance-conv-");
  svc = await startService(join(base, "profile"), join(base, "ws"), ["--init-sample"]);
});
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }); });

const html = (page: Page) => page.locator("html");
const switchOf = (page: Page) => page.getByRole("switch", { name: "Dark mode" });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();

test("switching keeps the open conversation and a half-typed follow-up (provider double, not AI)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(await launchUrl(svc!));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await nav(page, "Settings");
  const form = page.getByRole("form", { name: "Add a provider" });
  await form.getByLabel("Name").fill("Local test double");
  await form.getByLabel("Base URL").fill(double.baseUrl);
  await form.getByLabel("Model").fill("nexus-test-double");
  await form.getByLabel("API key").fill("nexus-fake-appearance-key-7c2e");
  await form.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByRole("listitem", { name: "Provider Local test double" })).toContainText(/Tool calling: Yes/);
  await nav(page, "Home");
  const question = "Which action from the kickoff still has no issue?";
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(1);
  const url = page.url();
  const composer = page.getByRole("textbox", { name: "Ask about your notes and projects" });
  await composer.fill("And which one is tracked?");
  await switchOf(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(page.url()).toBe(url);
  await expect(page.getByRole("heading", { level: 1, name: question })).toBeVisible();
  await expect(page.getByRole("article", { name: "Answer" })).toHaveCount(1);
  await expect(composer).toHaveValue("And which one is tracked?");
});
