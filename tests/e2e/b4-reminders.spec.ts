// B4 ordinary reminders, end to end, with AI off and a controlled clock (NEXUS_TEST_CLOCK),
// on disposable copies of the fictional sample. The clock is moved only by the test, through
// the control-secret route; the browser never sees that secret.
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

let base: string;
let svc: Service | null = null;
test.beforeEach(async () => { base = await tempDir("nexus-b4-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }).catch(() => undefined); });

const NOW = "2026-12-01T08:00:00.000Z";
const deliveries = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "state", "deliveries.json"), "utf8")).deliveries as Array<{ targetKey: string; status: string; kind: string; batch: string | null }>;
async function setClock(s: Service, now: string): Promise<Array<{ targetKey: string }>> {
  const info = JSON.parse(await readFile(join(s.profile, "service.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${s.port}/api/v1/control/clock`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}`, "content-type": "application/json" }, body: JSON.stringify({ now }) });
  return (await res.json()).delivered;
}
const card = (page: Page, key: string) => page.getByTestId(`card-${key}`);
const toast = (page: Page) => page.getByTestId("reminder-toast");
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: new RegExp(`^${name}`) });

test("J4: a due date set on the board reminds once at 09:00, a pending date never does, and the reminder opens the issue", async ({ page, browser }) => {
  const ws = join(base, "ws");
  const profile = join(base, "profile");
  svc = await startService(profile, ws, ["--init-sample"], { NEXUS_TEST_CLOCK: NOW });
  await page.goto(await launchUrl(svc));
  await expect(page.getByText("AI is off", { exact: true })).toBeVisible();
  const second = await (await browser.newContext()).newPage(); // a second tab, for one delivery record across surfaces
  await second.goto(await launchUrl(svc));

  // 1. Set NEX-1's date to 3 December from the board, by keyboard.
  await page.goto(`http://127.0.0.1:${svc.port}/projects/NEX`);
  await card(page, "NEX-1").getByRole("button", { name: "Change due date" }).click();
  await card(page, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).fill("2026-12-03");
  await card(page, "NEX-1").getByLabel("Due date of NEX-1", { exact: true }).press("Enter");
  await expect(card(page, "NEX-1")).toContainText("3 Dec 2026");

  // 2. A date proposed for review (the fixed demo proposes 3 Dec as well, so first move it to 4 Dec by hand)…
  const api = await apiSession(svc);
  const nex1 = (await api("GET", "/issues/NEX-1")).body;
  await api("PATCH", "/issues/NEX-1", { baseRevision: nex1.revision, patch: { due: { date: "2026-12-04" } }, baseValues: { due: nex1.due } });
  await api("POST", "/review/demo"); // proposes 3 December, pending
  // …passes its 09:00 with no delivery.
  expect(await setClock(svc, "2026-12-03T09:30:00.000Z")).toEqual([]);
  await expect(toast(page)).toHaveCount(0);

  // 3. Reject the proposal; the accepted 4 December reminds once at 09:00 local time (GMT).
  const changes = (await api("GET", "/review/changes?state=open")).body.changes;
  for (const c of changes) await api("POST", `/review/changes/${c.changeId}/reject`);
  expect(await setClock(svc, "2026-12-04T08:59:00.000Z")).toEqual([]);
  expect(await setClock(svc, "2026-12-04T09:00:20.000Z")).toEqual([expect.objectContaining({ targetKey: "NEX-1" })]);
  for (const t of ["2026-12-04T09:01:00.000Z", "2026-12-04T09:30:00.000Z"]) expect(await setClock(svc, t)).toEqual([]);
  expect((await deliveries(ws)).filter((d) => d.kind === "issue")).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "delivered" })]);

  // Both tabs show the one delivery; the rail counts it.
  for (const p of [page, second]) await expect(toast(p)).toContainText("Build calendar view: Due today");
  await expect(nav(page, "Notifications")).toContainText("1");
  await second.close();

  // 4. The in-app notification opens the exact issue, by keyboard.
  await toast(page).getByRole("button", { name: "Open" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await expect(page).toHaveURL(/\/issues\/NEX-1\?id=iss_/);

  // 5. The Notifications list shows it, and seeing it clears the badge.
  await nav(page, "Notifications").click();
  await expect(page.getByTestId("delivery-issue")).toContainText("NEX-1 Build calendar view");
  await expect(nav(page, "Notifications")).not.toContainText("1");

  // 6. Test reminder, labelled, immediately.
  await page.getByRole("button", { name: "Send test reminder" }).click();
  await expect(toast(page).filter({ hasText: "Test reminder" })).toContainText("A test. It opens NEX-1 Build calendar view.");

  // 7. Restart after 5 December's would-be time: nothing is delivered again; a missed one shows once.
  await page.goto(`http://127.0.0.1:${svc.port}/issues/NEX-1`);
  const fresh = (await api("GET", "/issues/NEX-1")).body;
  await api("PATCH", "/issues/NEX-1", { baseRevision: fresh.revision, patch: { due: { date: "2026-12-05" } }, baseValues: { due: fresh.due } });
  await setClock(svc, "2026-12-04T12:00:00.000Z");
  await svc.stop();
  svc = await startService(profile, undefined, [], { NEXUS_TEST_CLOCK: "2026-12-06T10:00:00.000Z" });
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/notifications`);
  const away = page.getByRole("region", { name: "While you were away" });
  await expect(away).toContainText("NEX-1 Build calendar view");
  await expect(away).toContainText("while Nexus was closed");
  await expect(toast(page)).toHaveCount(0); // never shown as a new reminder
  // Opening it from the list reaches the issue.
  await away.getByRole("link", { name: "NEX-1 Build calendar view" }).click();
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  // Reopening again: no summary, no repeat.
  await svc.stop();
  svc = await startService(profile, undefined, [], { NEXUS_TEST_CLOCK: "2026-12-06T11:00:00.000Z" });
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/notifications`);
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByRole("region", { name: "While you were away" })).toHaveCount(0);
  const final = await deliveries(ws);
  expect(final.filter((d) => d.kind === "issue").map((d) => d.status)).toEqual(["delivered", "missed"]);
});

test("Settings change the timing, and an old or foreign reminder link explains itself", async ({ page }) => {
  const ws = join(base, "ws");
  svc = await startService(join(base, "profile"), ws, ["--init-sample"], { NEXUS_TEST_CLOCK: NOW });
  await page.goto(await launchUrl(svc));
  await page.goto(`http://127.0.0.1:${svc.port}/settings`);
  const form = page.getByRole("form", { name: "Reminder settings" });
  await form.getByLabel("Time on an all-day due date").fill("07:30");
  await form.getByRole("button", { name: "Save reminder settings" }).click();
  await expect(form).toContainText("Saved.");
  expect(JSON.parse(await readFile(join(ws, ".nexus", "reminders.json"), "utf8"))).toMatchObject({ allDayTime: "07:30" });
  expect(await setClock(svc, "2026-12-05T07:30:30.000Z")).toEqual([expect.objectContaining({ targetKey: "NEX-1" })]);
  await expect(toast(page)).toContainText("Build calendar view");

  const wsId = JSON.parse(await readFile(join(ws, ".nexus", "workspace.json"), "utf8")).workspaceId;
  await page.goto(`http://127.0.0.1:${svc.port}/notifications/open?id=dlv_01KAR5Y3S2M8Q4K7Y2C9X5V6Z9&ws=${wsId}`);
  await expect(page.getByRole("alert")).toHaveText("This reminder is no longer in this workspace's history.");
  await page.goto(`http://127.0.0.1:${svc.port}/notifications/open?id=dlv_01KAR5Y3S2M8Q4K7Y2C9X5V6Z9&ws=wsp_01KAR5Y3S0M8Q4K7Y2C9X5V6ZZ`);
  await expect(page.getByRole("alert")).toContainText("belongs to a workspace that is not open now");
});

test("Electron: the native notification is the same delivery, its click opens the issue, and denial falls back to in-app", async () => {
  const electronPath = (await import("electron")).default as unknown as string;
  for (const mode of ["granted", "denied"] as const) {
    const dir = join(base, mode);
    const ws = join(dir, "ws");
    const notifyLog = join(dir, "native.jsonl");
    const { cp } = await import("node:fs/promises");
    await cp(join(process.cwd(), "samples", "meeting-workspace"), ws, { recursive: true });
    const env = { ...process.env, NEXUS_PROFILE_DIR: join(dir, "profile"), NEXUS_WORKSPACE: ws, NEXUS_TEST_CLOCK: NOW, NEXUS_E2E_NOTIFY_LOG: notifyLog, ...(mode === "denied" ? { NEXUS_NATIVE_NOTIFICATIONS: "denied" } : {}) } as Record<string, string>;
    // An IDE terminal may set ELECTRON_RUN_AS_NODE, which would start Electron as plain Node
    // rather than as the application (run-5 review, checks).
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ executablePath: electronPath, args: [resolve("apps/desktop/dist/main.cjs")], env, timeout: 60_000 });
    try {
      const win = await app.firstWindow();
      await expect(win.getByRole("heading", { name: "What do you need?" })).toBeVisible();
      const info = JSON.parse(await readFile(join(dir, "profile", "service.json"), "utf8"));
      const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/control/clock`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}`, "content-type": "application/json" }, body: JSON.stringify({ now: "2026-12-05T09:00:30.000Z" }) });
      const [delivered] = (await res.json()).delivered as Array<{ id: string }>;
      await expect(win.getByTestId("reminder-toast")).toContainText("Build calendar view: Due today"); // in-app, always
      if (mode === "granted") {
        await expect.poll(async () => (await readFile(notifyLog, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id)).toEqual([delivered!.id]);
        expect(JSON.parse((await readFile(notifyLog, "utf8")).trim())).toMatchObject({ title: "Reminder: NEX-1", body: "Build calendar view. Due today" });
        await win.getByTestId("reminder-toast").getByRole("button", { name: "Dismiss" }).click();
        await app.evaluate(({ app: a }, id) => { (a as unknown as NodeJS.EventEmitter).emit("nexus:test-notification-click", id); }, delivered!.id); // the OS click, simulated
        await expect(win.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
      } else {
        await win.getByRole("link", { name: /^Notifications/ }).click();
        await expect(win.getByRole("note").filter({ hasText: "Desktop notifications are off" })).toContainText("simulated for a test");
        expect(await readFile(notifyLog, "utf8").catch(() => "")).toBe(""); // nothing native was shown
      }
    } finally {
      await app.close();
    }
  }
});
