// R6-4 and R6-5 (Astra 6.2's run-6 review) through the real service and the deterministic
// provider double (a labelled fixture, not AI): a note correction may change only the disputed
// lines, and a correction's turns in the conversation say which change they correct.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ChangeView } from "@nexus/schema";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

const NOTE = "meetings/2026-11-24 kickoff.md";
const EDIT = "Create the missing issue, link it to its source heading and update the note line, and set NEX-1 due on 3 December.";
let double: ProviderDouble;
let base: string;
let svc: RunningService | null = null;
let n = 0;
beforeAll(async () => { double = await startProviderDouble(); base = await mkdtemp(join(tmpdir(), "nexus-correction-r6-http-")); });
afterAll(async () => { await svc?.stop(); await double.close(); await rm(base, { recursive: true, force: true }); });
afterEach(async () => { await svc?.stop(); svc = null; });

type Api = ReturnType<typeof client>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle = async (api: Api, id: string) => {
  for (let i = 0; i < 200; i++) {
    if (!(await api.get(`/conversations/${id}`)).body.messages.some((m: { status: string }) => m.status === "running")) return;
    await sleep(100);
  }
  throw new Error("the conversation did not finish");
};
const one = async (api: Api, id: string): Promise<ChangeView> => (await api.get("/review/changes?state=all")).body.changes.find((c: ChangeView) => c.changeId === id);

async function editRun(model: string) {
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, `ws-${++n}`));
  svc = await startService({ profile: join(base, `profile-${n}`), workspace: ws });
  const api = client(svc, await openSession(svc));
  const p = (await api.post("/providers", { name: "Test double", baseUrl: double.baseUrl, model })).body;
  await api.put(`/providers/${p.id}/session-key`, { key: "nexus-fake-correction-r6-key" });
  await api.post(`/providers/${p.id}/test`);
  const conv = (await api.post("/conversations", {})).body;
  await api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" });
  await idle(api, conv.id);
  await api.post(`/conversations/${conv.id}/ask`, { question: EDIT, mode: "edit" });
  await idle(api, conv.id);
  const open = (await api.get("/review/changes?state=open")).body.changes as ChangeView[];
  return { ws, api, conv, open };
}

describe("R6-4: the write boundary of a note correction", () => {
  it("refuses a correction that also changes the line above the disputed one, and writes nothing", async () => {
    const { ws, api, conv, open } = await editRun("nexus-test-double-wide");
    const line = open.find((c) => c.kind === "note.replaceSpan")!;
    expect((await api.post(`/review/changes/${line.changeId}/reject`)).body.state).toBe("rejected");
    const before = await readFile(join(ws, ...NOTE.split("/")), "utf8");
    await api.post(`/review/changes/${line.changeId}/feedback`, { text: "Use “- [ ] Will writes the judging notes”." });
    await idle(api, conv.id);
    const after = await readFile(join(ws, ...NOTE.split("/")), "utf8");
    expect(after).toBe(before);
    expect(after).toContain("- [ ] Hein builds the calendar view\n");
    const c = (await one(api, line.changeId)).correction!;
    expect(c.state).toBe("no-change");
    expect(c.message).toContain("may change only");
    expect((await api.get("/review/changes?state=all")).body.changes.filter((x: ChangeView) => x.supersedes)).toEqual([]);
  });
});

describe("R6-5: a correction's turns say which change they correct", () => {
  it("stores the rejected change's ID on both turns of the correction", async () => {
    const { api, conv, open } = await editRun("nexus-test-double");
    const due = open.find((c) => c.kind === "record.updateField")!;
    await api.post(`/review/changes/${due.changeId}/reject`);
    await api.post(`/review/changes/${due.changeId}/feedback`, { text: "Hein is away that week; make it 8 December." });
    await idle(api, conv.id);
    const messages = (await api.get(`/conversations/${conv.id}`)).body.messages as Array<{ role: string; text: string | null; correctionOf?: string }>;
    const turns = messages.filter((m) => m.correctionOf);
    expect(turns.map((m) => [m.role, m.correctionOf])).toEqual([["user", due.changeId], ["assistant", due.changeId]]);
    expect(turns[0]!.text).toContain("Correct the rejected change");
    // An ordinary Edit turn carries none.
    expect(messages.filter((m) => m.text === EDIT).map((m) => m.correctionOf)).toEqual([undefined]);
  });
});
