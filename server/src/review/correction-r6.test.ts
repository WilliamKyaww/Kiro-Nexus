// R6-3, R6-4 and R6-7 (Astra 6.2's run-6 review): a correction supersedes its rejected change
// only once the correction can be reviewed; it may change only the disputed lines or field; and a
// reason saved just before a crash still offers a correction. In-process engine on disposable
// copies of the fictional sample.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, type ChangeView } from "@nexus/schema";
import { setFaultInjector } from "../faults";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { ReviewEngine } from "./engine";

const NOTE = "meetings/2026-11-24 kickoff.md";
let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (test double, not AI)", conversationId: "cnv_fixture", model: "nexus-test-double" };
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `correction-r6-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};
const reopen = async () => { await service.close(); await open(); };
const nex1Due = async () => IssuesFile.parse(JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"))).issues.find((i) => i.key === "NEX-1")!.due;
const noteText = () => readFile(join(ws, ...NOTE.split("/")), "utf8");
const view = async (id: string) => (await engine.views("all")).find((v) => v.changeId === id)!;
const failIssuesWrite = () => setFaultInjector((point) => { if (point === "review:write:.nexus/issues.json") throw new Error("Simulated locked issues file"); });

async function rejectedDate(): Promise<ChangeView> {
  const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
  const due = (await engine.propose(source, [{ opId: "e1-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-03" } }], "agent")).changes[0]!;
  await engine.reject(due.changeId);
  return engine.feedback(due.changeId, "Hein is away that week; make it 8 December.");
}
async function correctDate(rejected: ChangeView, askRunId: string, date = "2026-12-08", prefix = "c1") {
  const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
  return engine.propose(source, [{ opId: `${prefix}-due`, kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date } }], "agent", { supersedes: rejected.changeId, correctionRunId: askRunId });
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-correction-r6-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("R6-3: a correction that never reaches the file does not supersede its change", () => {
  it("leaves the change rejected while the correction is unwritten, and supersedes it once Retry writes it", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    failIssuesWrite();
    const outcome = await correctDate(rejected, "run_A");
    setFaultInjector(null);
    expect(outcome.phase).toBe("partial");
    expect(outcome.changes[0]).toMatchObject({ state: "prepared", supersedes: rejected.changeId });
    expect(await nex1Due()).toEqual({ date: "2026-12-05" });
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected", correction: { state: "unwritten" } });
    // It is listed, and a second correction cannot start while this one waits to be written.
    expect((await engine.views("corrections")).map((v) => v.changeId)).toEqual([rejected.changeId]);
    expect((await engine.beginCorrection(rejected.changeId, "run_B", "cnv_fixture")).started).toBe(false);
    // The same after a restart: still unwritten, not superseded, not "stopped".
    await reopen();
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected", correction: { state: "unwritten" } });
    // Retry writing makes the correction reviewable, and only then is the change superseded.
    await engine.retry(outcome.runId!);
    expect(await view(outcome.changes[0]!.changeId)).toMatchObject({ state: "pending" });
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded", correction: { state: "proposed" } });
    expect(await nex1Due()).toEqual({ date: "2026-12-08" });
  });

  it("after Discard, offers the correction again from the saved reason, also after a restart", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    failIssuesWrite();
    const outcome = await correctDate(rejected, "run_A");
    setFaultInjector(null);
    await engine.discard(outcome.runId!);
    const after = await view(rejected.changeId);
    expect(after).toMatchObject({ state: "rejected", feedback: "Hein is away that week; make it 8 December.", correction: { state: "failed" } });
    expect(after.correction!.message).toContain("never written");
    await reopen();
    expect((await engine.views("corrections")).map((v) => v.changeId)).toEqual([rejected.changeId]);
    expect((await engine.beginCorrection(rejected.changeId, "run_B", "cnv_fixture")).started).toBe(true);
    await correctDate(rejected, "run_B", "2026-12-08", "c2");
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded" });
  });
});

describe("R6-4: a note correction may change only the disputed lines", () => {
  async function rejectedLine(): Promise<ChangeView> {
    const raw = (await service.readNoteRaw(NOTE))!;
    const line = (await engine.propose(source, [{ opId: "e1-line", kind: "note.replaceSpan", file: NOTE, baseRevision: raw.revision, before: "- [ ] Will writes the judge instructions\n", after: "- [ ] Will writes the judge guide\n" }], "agent")).changes[0]!;
    await engine.reject(line.changeId);
    return engine.feedback(line.changeId, "Use “- [ ] Will writes the judging notes”.");
  }
  const correctLine = async (rejected: ChangeView, before: string, after: string, prefix: string) => {
    const raw = (await service.readNoteRaw(NOTE))!;
    return engine.propose(source, [{ opId: `${prefix}-line`, kind: "note.replaceSpan", file: NOTE, baseRevision: raw.revision, before, after }], "agent", { supersedes: rejected.changeId, correctionRunId: "run_A" });
  };

  it("refuses an edit that reaches an adjacent line, and an edit elsewhere, writing nothing", async () => {
    const rejected = await rejectedLine();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    const before = await noteText();
    // Overlaps the disputed line, but also ticks the line above it.
    await expect(correctLine(rejected,
      "- [ ] Hein builds the calendar view\n- [ ] Will writes the judge instructions\n",
      "- [x] Hein builds the calendar view\n- [ ] Will writes the judging notes\n", "w1")).rejects.toMatchObject({ code: "VALIDATION" });
    // Another line of the note altogether.
    await expect(correctLine(rejected, "- [ ] Hein builds the calendar view\n", "- [x] Hein builds the calendar view\n", "w2")).rejects.toMatchObject({ code: "VALIDATION" });
    // A field instead of the lines.
    const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
    await expect(engine.propose(source, [{ opId: "w3-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-09" } }], "agent", { supersedes: rejected.changeId, correctionRunId: "run_A" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await noteText()).toBe(before);
    expect(await view(rejected.changeId)).toMatchObject({ state: "rejected", correction: { state: "running" } });
    // The disputed line itself is accepted as a correction.
    await correctLine(rejected, "- [ ] Will writes the judge instructions\n", "- [ ] Will writes the judging notes\n", "ok");
    expect(await noteText()).toContain("- [ ] Will writes the judging notes\n");
    expect(await noteText()).toContain("- [ ] Hein builds the calendar view\n");
    expect(await view(rejected.changeId)).toMatchObject({ state: "superseded" });
  });

  it("refuses a field correction to another field or issue, and more than one operation", async () => {
    const rejected = await rejectedDate();
    await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture");
    const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
    const op = (opId: string, field: "due" | "priority", after: unknown) => ({ opId, kind: "record.updateField" as const, file: ".nexus/issues.json" as const, recordKey: "NEX-1", field, baseRevision: issue.revision, before: issue[field], after });
    await expect(engine.propose(source, [op("p1", "priority", "low")], "agent", { supersedes: rejected.changeId, correctionRunId: "run_A" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(engine.propose(source, [op("p2", "due", { date: "2026-12-08" }), op("p3", "priority", "low")], "agent", { supersedes: rejected.changeId, correctionRunId: "run_A" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(service.listIssues().find((i) => i.key === "NEX-1")).toMatchObject({ priority: "high", due: { date: "2026-12-05" } });
  });
});

describe("R6-7: a reason saved just before a crash still offers its correction", () => {
  it("lists the change with Retry after a restart, keeping the reason", async () => {
    const rejected = await rejectedDate(); // the reason is saved; the correction run is never admitted
    await reopen();
    const listed = await engine.views("corrections");
    expect(listed.map((v) => v.changeId)).toEqual([rejected.changeId]);
    expect(listed[0]).toMatchObject({ feedback: "Hein is away that week; make it 8 December.", correction: { state: "failed", message: "Nexus stopped before the correction started." } });
    expect((await engine.beginCorrection(rejected.changeId, "run_A", "cnv_fixture")).started).toBe(true);
  });

  it("keeps Skip and Keep it rejected apart: neither is listed after a restart", async () => {
    const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
    const skipped = (await engine.propose(source, [{ opId: "s1-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-04" } }], "agent")).changes[0]!;
    await engine.reject(skipped.changeId); // Skip: no reason at all
    await reopen();
    expect(await engine.views("corrections")).toEqual([]);
    expect((await view(skipped.changeId)).correction).toBeNull();
  });
});
