// Run 6, stage 3: the J7 correction loop end to end (PRD-064, architecture 7.4), in Edge, with
// the deterministic provider double (a labelled fixture, not AI), a controlled clock and a
// disposable copy of the fictional sample. Live Edit still needs its own provider evidence.
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProviderDouble, type ProviderDouble } from "../../tools/provider-double/server.mjs";
import { apiSession, launchUrl, startService, tempDir, type Service } from "./support";

test.use({ trace: "off", screenshot: "off" }); // a fake key is typed in Settings
const KEY = "nexus-fake-e2e-j7-key-4b8d";
const NOTE = "meetings/2026-11-24 kickoff.md";
const QUESTION = "Which action from the kickoff still has no issue?";
const EDIT = "Create the missing issue, link it to its source heading and update the note line, and set NEX-1 due on 3 December.";
const REASON = "Hein is away that week; make it 8 December.";
const NOW = "2026-12-01T08:00:00.000Z";
const SHOTS = process.env.NEXUS_J7_SHOTS ?? "";
let double: ProviderDouble;
let base: string;
let svc: Service | null = null;
test.beforeAll(async () => { double = await startProviderDouble(); });
test.afterAll(async () => { await double.close(); });
test.beforeEach(async () => { base = await tempDir("nexus-j7-"); });
test.afterEach(async () => { await svc?.stop(); svc = null; await rm(base, { recursive: true, force: true }).catch(() => undefined); });

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true }).click();
const bar = (page: Page) => page.getByRole("region", { name: "Changes awaiting review" });
const reasonBox = (page: Page) => page.getByRole("textbox", { name: "What was wrong, or what should be kept? (optional)" });
const issuesOn = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<{ key: string; title: string; due: unknown; noteLinks: Array<{ headingSlug: string | null }> }>;
const journal = async (ws: string) => {
  const dir = join(ws, ".nexus", "reviews");
  const runs = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
  return runs.flatMap((r: { changes: Array<{ changeId: string; kind: string; state: string; supersedes: string | null; feedback: { text: string } | null }> }) => r.changes);
};
async function setClock(s: Service, now: string): Promise<Array<{ targetKey: string }>> {
  const info = JSON.parse(await readFile(join(s.profile, "service.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${s.port}/api/v1/control/clock`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}`, "content-type": "application/json" }, body: JSON.stringify({ now }) });
  return (await res.json()).delivered;
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

/** The grounded kickoff answer (Ask), then the user switches to Edit and asks for the changes. */
async function askThenEdit(page: Page, provider: ProviderDouble, edit = EDIT): Promise<{ ws: string; profile: string }> {
  const ws = join(base, "ws");
  const profile = join(base, "profile");
  svc = await startService(profile, ws, ["--init-sample"], { NEXUS_TEST_CLOCK: NOW });
  await page.goto(await launchUrl(svc));
  await nav(page, "Settings");
  const form = page.getByRole("form", { name: "Add a provider" });
  await form.getByLabel("Name").fill("Local test double");
  await form.getByLabel("Base URL").fill(provider.baseUrl);
  await form.getByLabel("Model").fill("nexus-test-double");
  await form.getByLabel("API key").fill(KEY);
  await form.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByRole("listitem", { name: "Provider Local test double" })).toContainText(/Tool calling: Yes/);
  await nav(page, "Home");
  await page.getByRole("textbox", { name: "Ask about your notes and projects" }).fill(QUESTION);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "Answer" }).last().getByRole("region", { name: "Recorded facts" })).toContainText("“Will writes the judge instructions” has no matching issue.");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe the changes for Nexus to propose" }).fill(edit);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return { ws, profile };
}

test("J7: accept the new task, reject the date with a reason, accept the corrected date after a restart; it reminds once and opens NEX-1", async ({ page, browser }) => {
  const { ws, profile } = await askThenEdit(page, double);

  // The first change opens by itself. Accept the note line with the new issue it needs.
  await expect(bar(page)).toContainText("Change 1 of 4");
  await expect(page.locator(".pending-block")).toContainText("Will writes the judge instructions (NEX-2)");
  await bar(page).getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("group", { name: "Accept related changes" }).getByRole("button", { name: "Accept both" }).click();

  // The bar moves to the proposed date on NEX-1. Reject it: Nexus asks why.
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await expect(page.getByText("5 Dec 2026 → 3 Dec 2026")).toBeVisible();
  await bar(page).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(bar(page)).toContainText("Rejected and undone: NEX-1 due: 2026-12-05 → 2026-12-03");
  await expect(reasonBox(page)).toBeFocused();
  expect((await issuesOn(ws)).find((i) => i.key === "NEX-1")!.due).toEqual({ date: "2026-12-05" });

  // The reason starts a correction; its change opens on the disputed target, highlighted.
  await reasonBox(page).fill(REASON);
  await bar(page).getByRole("button", { name: "Send reason" }).click();
  await expect(page).toHaveURL(/\/issues\/NEX-1\?change=chg_/);
  await expect(page.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await expect(page.getByText("5 Dec 2026 → 8 Dec 2026")).toBeVisible();
  await expect(bar(page)).toContainText("Correction of a change you rejected");
  await expect(bar(page)).toContainText("Nexus proposed a corrected change. Accept or reject it.");
  await expect(bar(page)).toContainText("(test double, not AI)");
  await shot(page, "j7-corrected-date-desktop");

  // Accept the remaining link from the bar.
  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "NEX-2 Write the judge instructions" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/NEX-1\?change=chg_/);

  // Restart with the corrected date still pending: it is restored, and accepted.
  await svc!.stop();
  svc = await startService(profile, undefined, [], { NEXUS_TEST_CLOCK: NOW });
  const page2 = await (await browser.newContext()).newPage();
  await page2.goto(await launchUrl(svc));
  await expect(bar(page2)).toContainText("Change 1 of 1");
  await expect(bar(page2)).toContainText("Correction of a change you rejected");
  await bar(page2).getByRole("button", { name: "Show" }).click();
  await expect(page2.getByText("5 Dec 2026 → 8 Dec 2026")).toBeVisible();
  await bar(page2).getByRole("button", { name: "Accept", exact: true }).click();
  await expect(bar(page2)).toContainText("All changes reviewed.");

  // On disk: exactly the accepted changes, and the note's unrelated text.
  const issues = await issuesOn(ws);
  expect(issues.map((i) => [i.key, i.due])).toEqual([["NEX-1", { date: "2026-12-08" }], ["NEX-2", null]]);
  expect(issues[1]).toMatchObject({ title: "Write the judge instructions", noteLinks: [expect.objectContaining({ headingSlug: "actions" })] });
  const note = await readFile(join(ws, ...NOTE.split("/")), "utf8");
  expect(note).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
  for (const kept of ["- [ ] Hein builds the calendar view", "## Decisions", "- Every agent edit is reviewed one change at a time.", "- Which free model route do we use for the live demo?"]) expect(note).toContain(kept);
  const changes = await journal(ws);
  const rejected = changes.find((c) => c.kind === "record.updateField" && c.state === "superseded")!;
  expect(rejected.feedback?.text).toBe(REASON);
  expect(changes.filter((c) => c.supersedes === rejected.changeId).map((c) => c.state)).toEqual(["accepted"]);
  expect(changes.map((c) => c.state).sort()).toEqual(["accepted", "accepted", "accepted", "accepted", "superseded"]);

  // Under the test clock, neither the old nor the rejected date reminds; the accepted one does, once.
  for (const t of ["2026-12-03T09:30:00.000Z", "2026-12-05T09:30:00.000Z", "2026-12-08T08:59:00.000Z"]) expect(await setClock(svc, t)).toEqual([]);
  expect(await setClock(svc, "2026-12-08T09:00:20.000Z")).toEqual([expect.objectContaining({ targetKey: "NEX-1" })]);
  expect(await setClock(svc, "2026-12-08T09:30:00.000Z")).toEqual([]);
  const toast = page2.getByTestId("reminder-toast");
  await expect(toast).toContainText("Build calendar view: Due today");
  await toast.getByRole("button", { name: "Open" }).click();
  await expect(page2.getByRole("heading", { name: "NEX-1 Build calendar view" })).toBeVisible();
  await expect(page2).toHaveURL(/\/issues\/NEX-1\?id=iss_/);
});

test("Skip asks nothing more; a correction that fails keeps its reason across a restart, and Retry corrects it", async ({ page, browser }) => {
  const own = await startProviderDouble();
  const port = own.port;
  const { ws, profile } = await askThenEdit(page, own);
  await expect(bar(page)).toContainText("Change 1 of 4");
  const api = await apiSession(svc!);
  const open = (await api("GET", "/review/changes?state=open")).body.changes as Array<{ changeId: string; kind: string }>;
  const due = open.find((c) => c.kind === "record.updateField")!;

  // Skip: the rejection stands and nothing else happens.
  await page.goto(`http://127.0.0.1:${svc!.port}/issues/NEX-1?change=${due.changeId}`);
  await bar(page).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(reasonBox(page)).toBeFocused();
  await bar(page).getByRole("button", { name: "Skip" }).click();
  await expect(reasonBox(page)).toHaveCount(0);
  expect((await journal(ws)).find((c) => c.changeId === due.changeId)).toMatchObject({ state: "rejected", feedback: null });
  const conversations = (await api("GET", "/conversations")).body.conversations as Array<{ id: string }>;
  const turns = async () => (await api("GET", `/conversations/${conversations[0]!.id}`)).body.messages.filter((m: { role: string; text: string | null }) => m.role === "user" && m.text?.startsWith("Correct the rejected change")).length;
  expect(await turns()).toBe(0);

  // Decide the new task, then ask for a date again in the same conversation.
  const line = open.find((c) => c.kind === "note.replaceSpan")!;
  const link = open.find((c) => c.kind === "record.addLink")!;
  await api("POST", `/review/changes/${line.changeId}/accept?withDependencies=1`);
  await api("POST", `/review/changes/${link.changeId}/accept`);
  await page.goto(`http://127.0.0.1:${svc!.port}/c/${conversations[0]!.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe the changes for Nexus to propose" }).fill("Set NEX-1 due on 4 December.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("5 Dec 2026 → 4 Dec 2026")).toBeVisible();

  // The provider goes down; the reason is still saved, and the bar says what happened.
  await bar(page).getByRole("button", { name: "Reject", exact: true }).click();
  await own.close();
  await reasonBox(page).fill(REASON);
  await bar(page).getByRole("button", { name: "Send reason" }).click();
  const failed = page.getByRole("group", { name: "Correction of a rejected change" });
  await expect(failed).toContainText("The correction did not finish", { timeout: 60_000 });
  await expect(failed).toContainText(`Your reason is saved: “${REASON}”`);
  await shot(page, "j7-correction-failed-desktop");

  // The failed turn in the conversation retries the same bound correction, never an ordinary
  // Edit that could change anything else (R6-5). The provider is still down, so it fails again.
  const disputed = (await journal(ws)).find((c) => c.kind === "record.updateField" && c.feedback?.text === REASON)!;
  await page.goto(`http://127.0.0.1:${svc!.port}/c/${conversations[0]!.id}`);
  const transcript = page.locator("ol.transcript > li");
  await expect(transcript.last().getByRole("alert")).toBeVisible();
  const count = await transcript.count();
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/api\/v1\/(conversations|review)\//.test(r.url()), { timeout: 10_000 });
  await transcript.nth(count - 1).getByRole("button", { name: /^Retry/ }).click();
  expect(new URL((await sent).url()).pathname).toBe(`/api/v1/review/changes/${disputed.changeId}/correction`);
  await expect(transcript.nth(count - 1)).toContainText("The correction did not finish.");
  await expect(transcript.nth(count - 1).getByRole("button", { name: "Retry correction" })).toBeVisible();
  await expect(transcript.nth(count + 1).getByRole("alert")).toContainText("The correction did not finish.", { timeout: 60_000 });

  // After a restart it is listed the same way, and Retry corrects once the provider is back.
  await svc!.stop();
  svc = await startService(profile, undefined, [], { NEXUS_TEST_CLOCK: NOW });
  const back = await startProviderDouble(port);
  try {
    const api2 = await apiSession(svc);
    const p = (await api2("GET", "/providers")).body.profiles[0];
    await api2("PUT", `/providers/${p.id}/session-key`, { key: KEY }); // browser keys last one session
    const page2 = await (await browser.newContext()).newPage();
    await page2.setViewportSize({ width: 390, height: 844 });
    await page2.goto(await launchUrl(svc));
    const listed = page2.getByRole("group", { name: "Correction of a rejected change" });
    await expect(listed).toContainText(`Your reason is saved: “${REASON}”`);
    await shot(page2, "j7-correction-retry-mobile");
    await listed.getByRole("button", { name: "Retry correction" }).click();
    await expect(page2).toHaveURL(/\/issues\/NEX-1\?change=chg_/, { timeout: 30_000 });
    await expect(page2.getByText("5 Dec 2026 → 8 Dec 2026")).toBeVisible();
    await expect(page2.getByRole("group", { name: "Correction of a rejected change" })).toHaveCount(0);
    await bar(page2).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(bar(page2)).toContainText("All changes reviewed.");
    expect((await issuesOn(ws)).find((i) => i.key === "NEX-1")!.due).toEqual({ date: "2026-12-08" });
  } finally {
    await back.close();
  }
});
