// The correction loop through the real service (PRD-064, run 6 stage 3): a reason for a
// rejected date starts one correction run, bound to that change and its target, whose change
// supersedes it. Real service process and the deterministic provider double (a labelled
// fixture, not AI); disposable copies of the fictional sample.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ChangeView } from "@nexus/schema";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

const ASK = "Which action from the kickoff still has no issue?";
const EDIT = "Create the missing issue, link it to its source heading and update the note line, and set NEX-1 due on 3 December.";
const REASON = "Hein is away that week; make it 8 December.";
let double: ProviderDouble;
let base: string;
let svc: RunningService | null = null;
let n = 0;
beforeAll(async () => { double = await startProviderDouble(); base = await mkdtemp(join(tmpdir(), "nexus-correction-http-")); });
afterAll(async () => { await svc?.stop(); await double.close(); await rm(base, { recursive: true, force: true }); });
afterEach(async () => { await svc?.stop(); svc = null; });

type Api = ReturnType<typeof client>;
const waitFor = async <T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const idle = (api: Api, id: string) => waitFor("the conversation to finish", async () => !(await api.get(`/conversations/${id}`)).body.messages.some((m: { status: string }) => m.status === "running"));
const all = async (api: Api): Promise<ChangeView[]> => (await api.get("/review/changes?state=all")).body.changes;
const one = async (api: Api, id: string) => (await all(api)).find((c) => c.changeId === id)!;
const nex1 = async (ws: string) => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues.find((i: { key: string }) => i.key === "NEX-1");
const issuesHash = async (ws: string) => createHash("sha256").update(await readFile(join(ws, ".nexus", "issues.json"))).digest("hex");

/** Ask, then Edit with a date: the new task (three changes) and NEX-1's due date, pending. */
async function editWithDate(opts: { model?: string; baseUrl?: string; env?: Record<string, string> } = {}) {
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, `ws-${++n}`));
  const profile = join(base, `profile-${n}`);
  svc = await startService({ profile, workspace: ws, env: opts.env });
  const api = client(svc, await openSession(svc));
  const p = (await api.post("/providers", { name: "Test double", baseUrl: opts.baseUrl ?? double.baseUrl, model: opts.model ?? "nexus-test-double" })).body;
  await api.put(`/providers/${p.id}/session-key`, { key: "nexus-fake-correction-key" });
  await api.post(`/providers/${p.id}/test`);
  const conv = (await api.post("/conversations", {})).body;
  await api.post(`/conversations/${conv.id}/ask`, { question: ASK });
  await idle(api, conv.id);
  expect((await api.post(`/conversations/${conv.id}/ask`, { question: EDIT, mode: "edit" })).status).toBe(202);
  await idle(api, conv.id);
  const open = (await api.get("/review/changes?state=open")).body.changes as ChangeView[];
  const due = open.find((c) => c.kind === "record.updateField")!;
  expect(due).toMatchObject({ recordKey: "NEX-1", field: "due", before: { date: "2026-12-05" }, after: { date: "2026-12-03" }, correctable: true });
  return { ws, profile, api, conv, open, due };
}

describe("a reason for a rejected Edit date", () => {
  it("starts one correction on the same target, even when sent twice at once; the correction supersedes the date", async () => {
    const { ws, api, conv, open, due } = await editWithDate();
    expect(open.map((c) => c.kind).sort()).toEqual(["note.replaceSpan", "record.addLink", "record.create", "record.updateField"]);
    expect((await api.post(`/review/changes/${due.changeId}/reject`)).body.state).toBe("rejected");
    expect((await nex1(ws)).due).toEqual({ date: "2026-12-05" });

    const sends = await Promise.all([1, 2].map(() => api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON })));
    expect(sends.map((s) => s.status)).toEqual([200, 200]);
    expect(sends.map((s) => s.body.correction?.state).sort()).toEqual(["running", "running"]);
    await idle(api, conv.id);

    const corrected = await waitFor("the corrected change", async () => (await all(api)).find((c) => c.supersedes === due.changeId));
    expect(corrected).toMatchObject({ state: "pending", recordKey: "NEX-1", field: "due", before: { date: "2026-12-05" }, after: { date: "2026-12-08" }, sourceLabel: "Edit by nexus-test-double (test double, not AI)" });
    expect(await one(api, due.changeId)).toMatchObject({ state: "superseded", feedback: REASON, supersededBy: [corrected.changeId], correction: { state: "proposed" } });
    expect((await all(api)).filter((c) => c.supersedes === due.changeId)).toHaveLength(1);
    expect((await nex1(ws)).due).toEqual({ date: "2026-12-08" });
    // The other changes of the Edit are untouched, still awaiting review.
    for (const c of open.filter((c) => c.changeId !== due.changeId)) expect((await one(api, c.changeId)).state).toBe("pending");
    // The conversation has one correction turn, which says what it proposed.
    const messages = (await api.get(`/conversations/${conv.id}`)).body.messages as Array<{ role: string; text: string | null; authority?: string; edit?: { changes: Array<{ changeId: string }> } | null }>;
    const turns = messages.filter((m) => m.role === "user" && m.text?.startsWith("Correct the rejected change"));
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ authority: "edit", text: `Correct the rejected change NEX-1 due: 2026-12-05 → 2026-12-03. Reason: ${REASON}` });
    expect(messages.at(-1)!.edit!.changes.map((c) => c.changeId)).toEqual([corrected.changeId]);
    expect(await api.get("/review/changes?state=corrections")).toMatchObject({ body: { changes: [] } });
  });

  it("repeats after a second rejection, from the current value, keeping accepted changes and manual work", async () => {
    const { ws, api, conv, open, due } = await editWithDate();
    const create = open.find((c) => c.kind === "record.create")!;
    const line = open.find((c) => c.kind === "note.replaceSpan")!;
    expect((await api.post(`/review/changes/${line.changeId}/accept?withDependencies=1`)).body.state).toBe("accepted");
    await api.post(`/review/changes/${due.changeId}/reject`);
    await api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON });
    await idle(api, conv.id);
    const first = await waitFor("the first correction", async () => (await all(api)).find((c) => c.supersedes === due.changeId));

    // A manual edit to another field of the same issue, then the second rejection.
    const issue = (await api.get("/issues/NEX-1")).body;
    expect((await api.patch("/issues/NEX-1", { baseRevision: issue.revision, patch: { priority: "urgent" }, baseValues: { priority: issue.priority } })).status).toBe(200);
    expect((await api.post(`/review/changes/${first.changeId}/reject`)).body.state).toBe("rejected");
    expect((await nex1(ws)).due).toEqual({ date: "2026-12-05" });
    await api.post(`/review/changes/${first.changeId}/feedback`, { text: "Still wrong: use 9 December." });
    await idle(api, conv.id);
    const second = await waitFor("the second correction", async () => (await all(api)).find((c) => c.supersedes === first.changeId));
    expect(second).toMatchObject({ state: "pending", before: { date: "2026-12-05" }, after: { date: "2026-12-09" } });
    expect(await one(api, due.changeId)).toMatchObject({ state: "superseded" });
    expect(await one(api, first.changeId)).toMatchObject({ state: "superseded", feedback: "Still wrong: use 9 December." });
    expect((await api.post(`/review/changes/${second.changeId}/accept`)).body.state).toBe("accepted");

    const after = await nex1(ws);
    expect(after).toMatchObject({ due: { date: "2026-12-09" }, priority: "urgent" });
    expect((await one(api, create.changeId)).state).toBe("accepted");
    const note = await readFile(join(ws, "meetings", "2026-11-24 kickoff.md"), "utf8");
    expect(note).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
    expect(note).toContain("- Which free model route do we use for the live demo?");
  });

  it("keeps the reason when the provider is down, and Retry corrects once it is back", async () => {
    const own = await startProviderDouble();
    const port = own.port;
    const { api, conv, due } = await editWithDate({ baseUrl: own.baseUrl });
    await api.post(`/review/changes/${due.changeId}/reject`);
    await own.close();
    const sent = await api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON });
    expect(sent.body).toMatchObject({ feedback: REASON, correction: { state: "running" } });
    const failed = await waitFor("the failed correction", async () => (await api.get("/review/changes?state=corrections")).body.changes.find((c: ChangeView) => c.correction?.state === "failed"), 60_000);
    expect(failed).toMatchObject({ changeId: due.changeId, state: "rejected", feedback: REASON });
    expect(failed.correction.message).toBeTruthy();
    await idle(api, conv.id);

    const back = await startProviderDouble(port);
    try {
      expect((await api.post(`/review/changes/${due.changeId}/correction`)).body.correction.state).toBe("running");
      await idle(api, conv.id);
      const corrected = await waitFor("the corrected change", async () => (await all(api)).find((c) => c.supersedes === due.changeId));
      expect(corrected.after).toEqual({ date: "2026-12-08" });
      expect((await api.get("/review/changes?state=corrections")).body.changes).toEqual([]);
    } finally {
      await back.close();
    }
  }, 120_000);

  it("survives a restart during the correction: failed with the reason kept, then Retry", async () => {
    const { ws, profile, api, conv, due } = await editWithDate({ env: { NEXUS_FAULT_DELAY: "ask:before-propose:3000" } });
    await api.post(`/review/changes/${due.changeId}/reject`);
    expect((await api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON })).body.correction.state).toBe("running");
    await new Promise((r) => setTimeout(r, 800)); // the correction now waits before its proposal
    const deadPort = svc!.port;
    svc!.child.kill(); // a crash: no clean shutdown
    await svc!.exited;
    // fetch keeps a pooled connection to the killed service. Use it up now, so that a later
    // service given the same port does not receive a reset on its first request.
    for (let i = 0; i < 3; i++) await fetch(`http://127.0.0.1:${deadPort}/api/v1/session`).catch(() => undefined);
    svc = await startService({ profile, workspace: ws });
    const api2 = client(svc, await openSession(svc));
    const listed = (await api2.get("/review/changes?state=corrections")).body.changes as ChangeView[];
    expect(listed).toEqual([expect.objectContaining({ changeId: due.changeId, state: "rejected", feedback: REASON, correction: expect.objectContaining({ state: "failed", message: "Nexus stopped before the correction finished." }) })]);
    expect((await api2.get(`/conversations/${conv.id}`)).body.messages.at(-1)).toMatchObject({ status: "failed", error: { code: "INTERRUPTED" } });
    expect((await nex1(ws)).due).toEqual({ date: "2026-12-05" });
    // The provider key was session-only: give it again, then Retry.
    const p = (await api2.get("/providers")).body.profiles[0];
    await api2.put(`/providers/${p.id}/session-key`, { key: "nexus-fake-correction-key" });
    expect((await api2.post(`/review/changes/${due.changeId}/correction`)).body.correction.state).toBe("running");
    await idle(api2, conv.id);
    const corrected = await waitFor("the corrected change", async () => (await all(api2)).find((c) => c.supersedes === due.changeId));
    expect(corrected).toMatchObject({ state: "pending", after: { date: "2026-12-08" } });
  }, 120_000);

  it("refuses a correction to another target and writes nothing; no date means no change; Keep it rejected closes it", async () => {
    const { ws, api, conv, due } = await editWithDate({ model: "nexus-test-double-stray" });
    await api.post(`/review/changes/${due.changeId}/reject`);
    const before = await issuesHash(ws);
    await api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON });
    await idle(api, conv.id);
    const refused = (await one(api, due.changeId)).correction!;
    expect(refused.state).toBe("no-change");
    expect(refused.message).toContain("A correction may change only the due of NEX-1");
    expect(await issuesHash(ws)).toBe(before);
    expect((await all(api)).filter((c) => c.supersedes)).toEqual([]);

    expect((await api.post(`/review/changes/${due.changeId}/correction/drop`)).body.correction.state).toBe("dropped");
    expect((await api.get("/review/changes?state=corrections")).body.changes).toEqual([]);
    expect((await one(api, due.changeId))).toMatchObject({ state: "rejected", feedback: REASON });
  });

  it("proposes nothing for a reason with no date, and a new reason then corrects it", async () => {
    const { api, conv, due } = await editWithDate();
    await api.post(`/review/changes/${due.changeId}/reject`);
    await api.post(`/review/changes/${due.changeId}/feedback`, { text: "That is the wrong week." });
    await idle(api, conv.id);
    expect((await one(api, due.changeId)).correction).toMatchObject({ state: "no-change", message: expect.stringContaining("does not name a date") });
    await api.post(`/review/changes/${due.changeId}/feedback`, { text: REASON });
    await idle(api, conv.id);
    const corrected = await waitFor("the corrected change", async () => (await all(api)).find((c) => c.supersedes === due.changeId));
    expect(corrected.after).toEqual({ date: "2026-12-08" });
  });

  it("keeps the reason only for a fixed demo change and for a new issue", async () => {
    const { api, open } = await editWithDate();
    const create = open.find((c) => c.kind === "record.create")!;
    await api.post(`/review/changes/${create.changeId}/reject?withDependents=1`);
    const issueReason = await api.post(`/review/changes/${create.changeId}/feedback`, { text: "Call it Write the judge guide." });
    expect(issueReason.body).toMatchObject({ feedback: "Call it Write the judge guide.", correctable: false, correction: null });
    expect((await api.post(`/review/changes/${create.changeId}/correction`)).status).toBe(400);

    const due = open.find((c) => c.kind === "record.updateField")!;
    await api.post(`/review/changes/${due.changeId}/reject`);
    const demo = (await api.post("/review/demo")).body;
    const demoDue = demo.changes.find((c: ChangeView) => c.kind === "record.updateField");
    await api.post(`/review/changes/${demoDue.changeId}/reject`);
    expect((await api.post(`/review/changes/${demoDue.changeId}/feedback`, { text: "Keep the 5th." })).body).toMatchObject({ feedback: "Keep the 5th.", correctable: false, correction: null });
    expect((await all(api)).filter((c) => c.supersedes)).toEqual([]);
  });
});
