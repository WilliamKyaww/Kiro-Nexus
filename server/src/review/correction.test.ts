// The correction loop in the review journal (PRD-064, architecture 7.4, run 6 stage 3): the
// reason is kept, a correction starts once, and the rejected change is superseded only once its
// correction is journaled, also after a crash. Disposable copies of the fictional sample.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ReviewRun, type ChangeView } from "@nexus/schema";
import { InjectedFault, setFaultInjector } from "../faults";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { ReviewEngine } from "./engine";

let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (test double, not AI)", conversationId: "cnv_fixture", model: "nexus-test-double" };
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `correction-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};
const nex1Due = async () => IssuesFile.parse(JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"))).issues.find((i) => i.key === "NEX-1")!.due;
const journals = async () => Promise.all((await readdir(join(ws, ".nexus", "reviews"))).map(async (f) => ReviewRun.parse(JSON.parse(await readFile(join(ws, ".nexus", "reviews", f), "utf8")))));
const view = async (id: string) => (await engine.views("all")).find((v) => v.changeId === id)!;

/** An Edit proposal of NEX-1's due date, then its rejection with a reason. */
async function rejectedDate(prefix = "e1"): Promise<ChangeView> {
  const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
  const outcome = await engine.propose(source, [{ opId: `${prefix}-due`, kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-03" } }], "agent");
  const due = outcome.changes[0]!;
  await engine.reject(due.changeId);
  return engine.feedback(due.changeId, "Hein is away that week; make it 8 December.");
}
async function correct(rejected: ChangeView, askRunId: string, date: string, prefix = "c1") {
  const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
  return engine.propose(source, [{ opId: `${prefix}-due`, kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date } }], "agent", { supersedes: rejected.changeId, correctionRunId: askRunId });
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-correction-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("the correction of a rejected change", () => {
  it("keeps the reason, starts once, and supersedes the change only when its correction is written", async () => {
    const rejected = await rejectedDate();
    expect(rejected).toMatchObject({ state: "rejected", feedback: "Hein is away that week; make it 8 December.", correctable: true, correction: null, conversationId: "cnv_fixture" });
    expect(await nex1Due()).toEqual({ date: "2026-12-05" });

    const first = await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    const second = await engine.beginCorrection(rejected.changeId, "run_B", "cnv_fixture");
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.view.correction).toMatchObject({ state: "running", askRunId: "run_A" });
    // A second send while it runs keeps the reason it was started with.
    expect((await engine.feedback(rejected.changeId, "Something else entirely.")).feedback).toBe("Hein is away that week; make it 8 December.");
    // Only the run that holds the correction may propose it.
    await expect(correct(rejected, "run_B", "2026-12-08")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected" });

    const outcome = await correct(rejected, "run_A", "2026-12-08");
    const corrected = outcome.changes[0]!;
    expect(corrected).toMatchObject({ state: "pending", supersedes: rejected.changeId, before: { date: "2026-12-05" }, after: { date: "2026-12-08" } });
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded", supersededBy: [corrected.changeId], correction: { state: "proposed" }, feedback: "Hein is away that week; make it 8 December." });
    expect(await nex1Due()).toEqual({ date: "2026-12-08" });
    // Once proposed, the correction cannot be proposed again.
    await expect(correct(rejected, "run_A", "2026-12-09", "c2")).rejects.toMatchObject({ code: "CONFLICT" });
    // On disk: the rejected change keeps its reason and says what corrected it.
    const old = (await journals()).flatMap((r) => r.changes).find((c) => c.changeId === rejected.changeId)!;
    expect(old.history.map((h) => h.state)).toEqual(["prepared", "pending", "rejecting", "rejected", "superseded"]);
    expect(old.feedback?.text).toBe("Hein is away that week; make it 8 December.");
  });

  it("supersedes after a crash between the correction's journal and the rejected change's", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    setFaultInjector((point) => { if (point === "review:before-supersede") throw new InjectedFault(point); });
    await expect(correct(rejected, "run_A", "2026-12-08")).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    // The correction is on disk, but the change it corrects still says rejected and running.
    const before = (await journals()).flatMap((r) => r.changes);
    expect(before.find((c) => c.changeId === rejected.changeId)).toMatchObject({ state: "rejected", correction: { state: "running" } });
    expect(before.find((c) => c.supersedes === rejected.changeId)).toMatchObject({ state: "pending" });

    await service.close();
    await open();
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded", correction: { state: "proposed" } });
    expect(await nex1Due()).toEqual({ date: "2026-12-08" });
  });

  it("marks a correction left running by a restart as failed, keeps the reason, and lets it start again", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    await service.close();
    await open();
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected", feedback: "Hein is away that week; make it 8 December.", correction: { state: "failed", message: "Nexus stopped before the correction finished." } });
    expect((await engine.views("corrections")).map((v) => v.changeId)).toEqual([rejected.changeId]);
    // The old run can no longer propose; a new one can.
    await expect(correct(rejected, "run_A", "2026-12-08")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await engine.beginCorrection(rejected.changeId, "run_C", "cnv_fixture")).started).toBe(true);
    await correct(rejected, "run_C", "2026-12-08");
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded" });
    expect(await engine.views("corrections")).toEqual([]);
  });

  it("records an empty or failed correction for Retry, and Keep it rejected closes it", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    // Another run cannot end it.
    await engine.endCorrection(rejected.changeId, "run_X", { state: "failed", message: "not mine" });
    expect((await view(rejected.changeId)).correction).toMatchObject({ state: "running" });
    await engine.endCorrection(rejected.changeId, "run_A", { state: "no-change", message: "The reason does not name a date." });
    expect((await view(rejected.changeId)).correction).toMatchObject({ state: "no-change", message: "The reason does not name a date." });
    // A new reason may replace the old one now that nothing is running.
    expect((await engine.feedback(rejected.changeId, "Make it 8 December.")).feedback).toBe("Make it 8 December.");
    expect((await engine.dropCorrection(rejected.changeId)).correction).toMatchObject({ state: "dropped" });
    expect(await engine.views("corrections")).toEqual([]);
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected", feedback: "Make it 8 December." });
  });

  it("does not start a correction for a fixed demo change, a new issue or a change with no reason", async () => {
    const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
    const demo = (await engine.propose({ kind: "fixed-demo", label: "Demo operations (fixed, not AI)" }, [{ opId: "d-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-03" } }], "demo")).changes[0]!;
    await engine.reject(demo.changeId);
    await engine.feedback(demo.changeId, "Keep the 5th.");
    expect((await engine.beginCorrection(demo.changeId, "run_A", null)).started).toBe(false);
    expect(await view(demo.changeId)).toMatchObject({ correctable: false, feedback: "Keep the 5th.", correction: null });

    const created = (await engine.propose(source, [{ opId: "n-create", kind: "record.create", file: ".nexus/issues.json", projectKey: "NEX", title: "Write the judge instructions" }], "agent")).changes[0]!;
    await engine.reject(created.changeId);
    await engine.feedback(created.changeId, "Call it Write the judge guide.");
    expect((await engine.beginCorrection(created.changeId, "run_B", "cnv_fixture")).started).toBe(false);
    expect((await view(created.changeId)).correctable).toBe(false);

    const noReason = await engine.propose(source, [{ opId: "r-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: service.listIssues().find((i) => i.key === "NEX-1")!.revision, before: { date: "2026-12-05" }, after: { date: "2026-12-04" } }], "agent");
    await engine.reject(noReason.changes[0]!.changeId);
    expect((await engine.beginCorrection(noReason.changes[0]!.changeId, "run_C", "cnv_fixture")).started).toBe(false);
  });
});
