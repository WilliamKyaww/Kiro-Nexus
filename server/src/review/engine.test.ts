// B5 engine tests on a disposable copy of the fictional sample. Every check reads real files.
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ReviewRun } from "@nexus/schema";
import { InjectedFault, setFaultInjector } from "../faults";
import { dueReminders, effectiveAcceptedIssues, zonedTimeToUtc } from "../scheduler/reminders";
import { sha256 } from "../workspace/atomic";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { DEMO_NOTE, demoOperations } from "./index";
import { ReviewEngine } from "./engine";

let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let n = 0;
const lock = () => ({ pid: process.pid, instanceId: `t-${++n}`, port: null, startedAt: new Date().toISOString() });
const noteFile = () => join(ws, ...DEMO_NOTE.split("/"));
const readNote = () => readFile(noteFile(), "utf8");
const readIssues = async () => IssuesFile.parse(JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")));
const nex1 = async () => (await readIssues()).issues.find((i) => i.key === "NEX-1")!;
const journals = async () => (await readdir(join(ws, ".nexus", "reviews")).catch(() => [])).filter((f) => f.endsWith(".json"));
const source = { kind: "fixed-demo" as const, label: "Demo operations (fixed, not AI)" };

async function open(): Promise<void> {
  service = await WorkspaceService.open(ws, { lock: lock() });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
}
/** Simulate a crash: drop the in-memory engine and reopen from disk. */
async function restart(): Promise<void> {
  setFaultInjector(null);
  await service.close();
  await open();
}
const failAt = (point: string, nth = 1) => {
  let hits = 0;
  setFaultInjector((p) => { if (p === point && ++hits === nth) throw new InjectedFault(p); });
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-review-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => {
  setFaultInjector(null);
  await service.close();
  await rm(base, { recursive: true, force: true });
});

describe("propose and apply", () => {
  it("writes nothing when an operation is invalid", async () => {
    const before = await readNote();
    const ops = await demoOperations(service);
    ops[0] = { ...ops[0]!, before: "- [ ] A line that is not there\n" } as typeof ops[0];
    await expect(engine.propose(source, ops, "demo")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readNote()).toBe(before);
    expect((await nex1()).due).toEqual({ date: "2026-12-05" });
    expect(await journals()).toEqual([]);
  });

  it("journals first, then writes a real note change and a real issue change", async () => {
    const result = await engine.propose(source, await demoOperations(service), "demo");
    expect(result.changes.map((c) => c.state)).toEqual(["pending", "pending"]);
    expect(await readNote()).toContain("- [x] Hein builds the calendar view\n");
    expect(await nex1()).toMatchObject({ due: { date: "2026-12-03" }, revision: 2 });
    const [file] = await journals();
    const run = ReviewRun.parse(JSON.parse(await readFile(join(ws, ".nexus", "reviews", file!), "utf8")));
    expect(run.source).toMatchObject({ kind: "fixed-demo", label: "Demo operations (fixed, not AI)" });
    expect(run.phase).toBe("applied");
    expect(run.files.map((f) => f.state)).toEqual(["written", "written"]);
    expect(run.files[0]!.afterHash).toBe(sha256(await readFile(noteFile())));
  });

  it("does not apply a repeated operation twice", async () => {
    const ops = await demoOperations(service);
    await engine.propose(source, ops, "demo");
    const note = await readNote();
    const issues = await readIssues();
    const again = await engine.propose(source, ops, "demo");
    expect(again.runId).toBeNull();
    expect(again.duplicates).toEqual(["demo-1-note-checklist", "demo-1-nex1-due"]);
    expect(await readNote()).toBe(note);
    expect(await readIssues()).toEqual(issues);
    expect(await journals()).toHaveLength(1);
  });
});

describe("decisions", () => {
  it("accepts the note change and rejects the date change across two files", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    const [noteChange, dueChange] = changes;
    await engine.accept(noteChange!.changeId);
    const rejected = await engine.reject(dueChange!.changeId);
    expect(rejected.state).toBe("rejected");
    expect(await readNote()).toContain("- [x] Hein builds the calendar view\n");
    expect(await nex1()).toMatchObject({ due: { date: "2026-12-05" }, revision: 3 });
    // Idempotent repeats, and an impossible transition.
    expect((await engine.accept(noteChange!.changeId)).state).toBe("accepted");
    expect((await engine.reject(dueChange!.changeId)).state).toBe("rejected");
    await expect(engine.accept(dueChange!.changeId)).rejects.toMatchObject({ code: "CONFLICT" });
    await engine.feedback(dueChange!.changeId, "Keep 5 December; Hein is away on the 3rd.");
    const views = await engine.views("all");
    expect(views.find((v) => v.changeId === dueChange!.changeId)?.feedback).toContain("Hein is away");
    expect(await engine.views("open")).toEqual([]);
  });

  it("keeps an unrelated manual edit when a note change is rejected", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    const current = await service.readNote(DEMO_NOTE);
    await service.saveNote(DEMO_NOTE, current.content.replace("## Open questions\n", "## Open questions\n\n- Added by hand after the agent edit.\n"), current.revision);
    await engine.reject(changes[0]!.changeId);
    const text = await readNote();
    expect(text).toContain("- [ ] Hein builds the calendar view\n");
    expect(text).toContain("- Added by hand after the agent edit.\n");
  });

  it("marks a rejection conflicted when the changed line was edited again, and keeps the newer text", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    const current = await service.readNote(DEMO_NOTE);
    const newer = current.content.replace("- [x] Hein builds the calendar view", "- [x] Hein builds the calendar view (done early)");
    await service.saveNote(DEMO_NOTE, newer, current.revision);
    const v = await engine.reject(changes[0]!.changeId);
    expect(v).toMatchObject({ state: "conflicted", conflictReason: "missing" });
    expect(await readNote()).toBe(newer);
    expect((await engine.keepCurrent(changes[0]!.changeId)).state).toBe("rejected");
    expect(await readNote()).toBe(newer);
  });

  it("refuses to guess when a repeated paragraph makes the target ambiguous", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    const current = await service.readNote(DEMO_NOTE);
    const section = "## Actions\n\n- [x] Hein builds the calendar view\n- [ ] Will writes the judge instructions\n";
    const duplicated = current.content + "\n" + section;
    await service.saveNote(DEMO_NOTE, duplicated, current.revision);
    const v = await engine.reject(changes[0]!.changeId);
    expect(v).toMatchObject({ state: "conflicted", conflictReason: "ambiguous" });
    expect(await readNote()).toBe(duplicated);
  });

  it("reverses only the due date when another field of the issue was edited by hand", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    await service.updateIssue("NEX-1", 2, { title: "Build the calendar view (month)" });
    await engine.reject(changes[1]!.changeId);
    expect(await nex1()).toMatchObject({ title: "Build the calendar view (month)", due: { date: "2026-12-05" }, revision: 4 });
  });

  it("marks a due-date rejection conflicted when the date was changed again by hand", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    await service.updateIssue("NEX-1", 2, { due: { date: "2026-12-04" } });
    const v = await engine.reject(changes[1]!.changeId);
    expect(v).toMatchObject({ state: "conflicted", conflictReason: "changed" });
    expect((await nex1()).due).toEqual({ date: "2026-12-04" });
  });
});

describe("recovery after a crash", () => {
  it("rolls forward when the crash came after the journal but before any file write", async () => {
    const note = await readNote();
    failAt("review:after-journal");
    await expect(engine.propose(source, await demoOperations(service), "demo")).rejects.toBeInstanceOf(InjectedFault);
    expect(await readNote()).toBe(note); // nothing written yet
    expect(await journals()).toHaveLength(1); // but the journal is durable
    await restart();
    expect(await readNote()).toContain("- [x] Hein builds the calendar view\n");
    expect((await nex1()).due).toEqual({ date: "2026-12-03" });
    expect((await engine.views("open")).map((v) => v.state)).toEqual(["pending", "pending"]);
  });

  it("completes a run interrupted between its two file writes", async () => {
    failAt("review:after-file-write", 1);
    await expect(engine.propose(source, await demoOperations(service), "demo")).rejects.toBeInstanceOf(InjectedFault);
    expect(await readNote()).toContain("- [x]"); // first file landed
    expect((await nex1()).due).toEqual({ date: "2026-12-05" }); // second did not
    await restart();
    const [file] = await journals();
    const run = ReviewRun.parse(JSON.parse(await readFile(join(ws, ".nexus", "reviews", file!), "utf8")));
    expect(run.phase).toBe("applied");
    expect(run.files[0]!.afterHash).toBe(sha256(await readFile(noteFile())));
    expect(run.files[1]!.afterHash).toBe(sha256(await readFile(join(ws, ".nexus", "issues.json"))));
    expect((await engine.views("open")).map((v) => v.state)).toEqual(["pending", "pending"]);
  });

  it("finishes a rejection interrupted before or after its file write", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    failAt("review:after-reversal-journal");
    await expect(engine.reject(changes[1]!.changeId)).rejects.toBeInstanceOf(InjectedFault);
    expect((await nex1()).due).toEqual({ date: "2026-12-03" });
    await restart();
    expect((await nex1()).due).toEqual({ date: "2026-12-05" });
    failAt("review:after-reversal-write");
    await expect(engine.reject(changes[0]!.changeId)).rejects.toBeInstanceOf(InjectedFault);
    expect(await readNote()).toContain("- [ ] Hein builds the calendar view\n");
    await restart();
    const states = (await engine.views("all")).map((v) => v.state);
    expect(states).toEqual(["rejected", "rejected"]);
  });

  it("protects a file edited outside Nexus while the service was down", async () => {
    failAt("review:after-journal");
    await expect(engine.propose(source, await demoOperations(service), "demo")).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await service.close();
    const outside = (await readNote()) + "\nWritten in another editor while Nexus was closed.\n";
    await writeFile(noteFile(), outside);
    await open();
    expect(await readNote()).toBe(outside);
    const views = await engine.views("open");
    expect(views.find((v) => v.kind === "note.replaceSpan")).toMatchObject({ state: "conflicted", conflictReason: "changed-before-apply" });
    expect(views.find((v) => v.kind === "record.updateField")).toMatchObject({ state: "pending" });
  });
});

describe("reminders use accepted values only (PRD-066)", () => {
  it("does not schedule a pending due date, and schedules it once accepted", async () => {
    const { changes } = await engine.propose(source, await demoOperations(service), "demo");
    const at = new Date("2026-12-03T09:30:00Z"); // 09:30 in London on the proposed date
    const pending = effectiveAcceptedIssues(service.listIssues(), engine.unsettledChanges());
    expect(pending.find((i) => i.key === "NEX-1")?.due).toEqual({ date: "2026-12-05" });
    expect(dueReminders(pending, { at, timeZone: "Europe/London" })).toEqual([]);
    await engine.accept(changes[1]!.changeId);
    const accepted = effectiveAcceptedIssues(service.listIssues(), engine.unsettledChanges());
    expect(dueReminders(accepted, { at, timeZone: "Europe/London" })).toEqual([
      expect.objectContaining({ issueKey: "NEX-1", at: "2026-12-03T09:00:00.000Z" }),
    ]);
  });

  it("uses the workspace time zone for all-day dates, including summer time", () => {
    expect(zonedTimeToUtc("2026-12-03", "09:00", "Europe/London").toISOString()).toBe("2026-12-03T09:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-03", "09:00", "Asia/Tokyo").toISOString()).toBe("2026-12-03T00:00:00.000Z");
  });
});
