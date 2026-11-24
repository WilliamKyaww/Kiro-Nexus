// B5 over HTTP against real service processes, including real crashes (NEXUS_FAULT exits with 86).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

let base: string;
let ws: string;
const running: RunningService[] = [];
const start = async (env?: Record<string, string>) => {
  const svc = await startService({ profile: join(base, "profile"), workspace: ws, env });
  running.push(svc);
  return { svc, api: client(svc, await openSession(svc)) };
};
const note = () => readFile(join(ws, "meetings", "2026-11-24 kickoff.md"), "utf8");
const due = async () => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues[0].due;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-review-http-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
});
afterEach(async () => {
  for (const svc of running.splice(0)) if (svc.child.exitCode === null) await svc.stop();
  await rm(base, { recursive: true, force: true });
});

describe("review over HTTP", () => {
  it("applies the labelled demo, takes per-change decisions and feedback, and keeps pending dates out of reminders", async () => {
    const { svc, api } = await start();
    expect((await fetch(`http://127.0.0.1:${svc.port}/api/v1/review/changes`)).status).toBe(401);

    const demo = await api.post("/review/demo");
    expect(demo.status).toBe(200);
    expect(demo.body.changes).toHaveLength(2);
    expect(demo.body.changes[0]).toMatchObject({ sourceKind: "fixed-demo", sourceLabel: "Demo operations (fixed, not AI)", state: "pending", lines: { start: 12, end: 12 } }); // line 12 of the sample note
    expect(demo.body.changes[1]).toMatchObject({ recordKey: "NEX-1", field: "due", current: { date: "2026-12-03" } });

    const atProposedDate = "/reminders/due?at=" + encodeURIComponent("2026-12-03T09:30:00Z");
    expect((await api.get(atProposedDate)).body.reminders).toEqual([]);

    const again = await api.post("/review/demo");
    expect(again.body).toMatchObject({ repeated: true, phase: "applied", duplicates: ["demo-1-note-checklist", "demo-1-nex1-due"] });

    const [noteChange, dueChange] = demo.body.changes;
    expect((await api.post(`/review/changes/${noteChange.changeId}/accept`)).body.state).toBe("accepted");
    expect((await api.post(`/review/changes/${dueChange.changeId}/reject`)).body.state).toBe("rejected");
    expect((await api.post(`/review/changes/${dueChange.changeId}/feedback`, { text: "Keep the 5th" })).body.feedback).toBe("Keep the 5th");
    expect((await api.get("/review/changes")).body.changes).toEqual([]);
    expect(await note()).toContain("- [x] Hein builds the calendar view\n");
    expect(await due()).toEqual({ date: "2026-12-05" });
    expect((await api.get("/reminders/due?at=" + encodeURIComponent("2026-12-05T09:30:00Z"))).body.reminders).toMatchObject([{ issueKey: "NEX-1" }]);
  });

  it("reports a real failed issue write honestly, then Retry after restart writes only that file", async () => {
    let { svc, api } = await start({ NEXUS_FAULT_THROW: "review:write:.nexus/issues.json" });
    const demo = await api.post("/review/demo");
    expect(demo.status).toBe(200);
    expect(demo.body.phase).toBe("partial");
    expect(demo.body.files.map((f: { state: string }) => f.state)).toEqual(["written", "failed"]);
    expect(await due()).toEqual({ date: "2026-12-05" });
    await svc.stop();
    running.splice(0);
    ({ svc, api } = await start());
    const incomplete = (await api.get("/review/runs/incomplete")).body.runs;
    expect(incomplete).toHaveLength(1);
    const noteBefore = await note();
    const retried = await api.post(`/review/runs/${incomplete[0].runId}/retry`);
    expect(retried.body.files.map((f: { state: string }) => f.state)).toEqual(["written", "written"]);
    expect(await due()).toEqual({ date: "2026-12-03" });
    expect(await note()).toBe(noteBefore);
    expect((await api.get("/review/runs/incomplete")).body.runs).toEqual([]);
  });

  it("recovers a real crash between the two file writes of a run", async () => {
    const { svc, api } = await start({ NEXUS_FAULT: "review:after-file-write:1" });
    await expect(api.post("/review/demo")).rejects.toThrow();
    expect(await svc.exited).toBe(86);
    expect(await note()).toContain("- [x] Hein builds the calendar view\n");
    expect(await due()).toEqual({ date: "2026-12-05" });

    const { api: api2 } = await start();
    const open = (await api2.get("/review/changes")).body.changes;
    expect(open.map((c: { state: string }) => c.state)).toEqual(["pending", "pending"]);
    expect(await due()).toEqual({ date: "2026-12-03" });
  });

  it("recovers a real crash in the middle of a rejection", async () => {
    let { svc, api } = await start();
    const { changes } = (await api.post("/review/demo")).body;
    await svc.stop();
    running.splice(0);
    ({ svc, api } = await start({ NEXUS_FAULT: "review:after-reversal-journal" }));
    await expect(api.post(`/review/changes/${changes[1].changeId}/reject`)).rejects.toThrow();
    expect(await svc.exited).toBe(86);
    expect(await due()).toEqual({ date: "2026-12-03" }); // reversal journaled, not yet written

    const { api: api3 } = await start();
    const all = (await api3.get("/review/changes?state=all")).body.changes;
    expect(all.find((c: { changeId: string }) => c.changeId === changes[1].changeId).state).toBe("rejected");
    expect(await due()).toEqual({ date: "2026-12-05" });
    expect(await note()).toContain("- [x] Hein builds the calendar view\n"); // the other change is untouched
  });
});
