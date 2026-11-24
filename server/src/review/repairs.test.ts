// Run 5, stage 1: regression tests for the journal findings of the run-4 review (reviewer:
// the Codex extension, designated Astra 6.2, run by Will). Each test follows the reviewer's
// reproduction on a disposable copy of the fictional sample, and reads the real files.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ProjectsFile, type ChangeRecord, type Issue, type ProposedOperation } from "@nexus/schema";
import { toProposedOperations } from "../ask/edit";
import { HandleRegistry } from "../ask/handles";
import { makeAskTools, newConsulted } from "../ask/tools";
import { readOnlyWorkspace } from "../ask/workspace";
import { InjectedFault, setFaultInjector } from "../faults";
import { SearchIndex } from "../notes/search";
import { effectiveAcceptedIssues } from "../scheduler/reminders";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { ReviewEngine } from "./engine";

const NOTE = "meetings/2026-11-24 kickoff.md";
const LINE = "- [ ] Will writes the judge instructions\n";
const PLAN = "plans/week plan.md";
let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let index: SearchIndex | null = null;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (test double, not AI)" };
const read = (rel: string) => readFile(join(ws, ...rel.split("/")), "utf8");
const issues = async () => IssuesFile.parse(JSON.parse(await read(".nexus/issues.json"))).issues;
const nex1Due = async () => (await issues()).find((i) => i.key === "NEX-1")!.due;
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `repairs-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};
const reopen = async () => { index?.dispose(); index = null; await service.close(); await open(); };
const states = async () => (await engine.views("all")).map((v) => `${v.kind} ${v.state}`).sort();

async function proposeJ7(prefix: string) {
  const note = await service.readNote(NOTE);
  const ops: ProposedOperation[] = [
    { opId: `${prefix}-create`, kind: "record.create", file: ".nexus/issues.json", projectKey: "NEX", title: "Write the judge instructions" },
    { opId: `${prefix}-link`, kind: "record.addLink", file: ".nexus/issues.json", issueRef: `${prefix}-create`, link: { notePath: NOTE, headingSlug: "actions", headingText: null } },
    { opId: `${prefix}-line`, kind: "note.replaceSpan", file: NOTE, baseRevision: note.revision, before: LINE, after: `- [ ] Will writes the judge instructions ({{issue:${prefix}-create}})\n` },
  ];
  const outcome = await engine.propose(source, ops, "agent");
  const byKind = (kind: string) => outcome.changes.find((c) => c.kind === kind)!;
  return { outcome, create: byKind("record.create"), link: byKind("record.addLink"), line: byKind("note.replaceSpan") };
}

async function proposeDue(opId: string, date: string) {
  const issue = service.listIssues().find((i) => i.key === "NEX-1")!;
  return engine.propose(source, [{ opId, kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due", baseRevision: issue.revision, before: issue.due, after: { date } }], "agent");
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-repairs-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); index?.dispose(); index = null; await service.close(); await rm(base, { recursive: true, force: true }); });

// ---------------- R4-1 ----------------

describe("R4-1: an Edit writes only in the section the run read, as it was read", () => {
  const week = (tuesday: string) => `# Week plan\n\nFictional sample data.\n\n## Monday\n\n- Draft the agenda\n\n## Tuesday\n\n${tuesday}\n`;
  async function askTools() {
    index = await SearchIndex.build(service);
    const wsr = readOnlyWorkspace(service, index, engine);
    const consulted = newConsulted();
    return { wsr, consulted, tools: makeAskTools(wsr, new HandleRegistry(), consulted) };
  }
  const edit = (heading: string, before: string, after: string) => [{ op: "edit_note" as const, note: PLAN, heading, before, after }];

  it("refuses, and writes nothing, when the section read has an edit awaiting review (the reviewer's case)", async () => {
    const created = await service.createNote(PLAN, week("- Prepare the slides"));
    await engine.propose(source, [{ opId: "mon", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "- Draft the agenda\n", after: "- Send the agenda\n" }], "agent");
    const pending = await service.readNote(PLAN);
    await service.saveNote(PLAN, pending.content.replace("- Prepare the slides", "- Draft the agenda"), pending.revision); // Tuesday now has the same line
    const before = await read(PLAN);
    const { wsr, consulted, tools } = await askTools();
    expect(await tools.read_note_section({ path: PLAN, headingSlug: "monday" })).toMatchObject({ text: "- Draft the agenda" }); // the accepted text
    const mapped = await toProposedOperations(edit("monday", "- Draft the agenda", "- File the agenda"), wsr, "e1", consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    await expect(engine.propose(source, mapped.operations, "agent")).rejects.toMatchObject({ code: "VALIDATION", details: [expect.objectContaining({ reason: expect.stringMatching(/changed since it was read, or has an edit awaiting review/) })] });
    expect(await read(PLAN)).toBe(before);
    expect(await read(PLAN)).toContain("## Tuesday\n\n- Draft the agenda\n");
  });

  it("changes only the section read when the same line is in another section", async () => {
    await service.createNote(PLAN, week("- Draft the agenda"));
    const { wsr, consulted, tools } = await askTools();
    await tools.read_note_section({ path: PLAN, headingSlug: "tuesday" });
    const mapped = await toProposedOperations(edit("tuesday", "- Draft the agenda", "- File the agenda"), wsr, "e2", consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    const outcome = await engine.propose(source, mapped.operations, "agent");
    expect(await read(PLAN)).toBe(week("- File the agenda"));
    // Recovery and rejection recompute the same scoped edit.
    await reopen();
    await engine.reject(outcome.changes[0]!.changeId);
    expect(await read(PLAN)).toBe(week("- Draft the agenda"));
  });

  it("refuses when the section was edited by hand between the read and the proposal", async () => {
    await service.createNote(PLAN, week("- Prepare the slides"));
    const { wsr, consulted, tools } = await askTools();
    await tools.read_note_section({ path: PLAN, headingSlug: "monday" });
    const note = await service.readNote(PLAN);
    await service.saveNote(PLAN, note.content.replace("- Draft the agenda", "- Draft the agenda\n- Book the room"), note.revision);
    const before = await read(PLAN);
    const mapped = await toProposedOperations(edit("monday", "- Draft the agenda", "- File the agenda"), wsr, "e3", consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    await expect(engine.propose(source, mapped.operations, "agent")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await read(PLAN)).toBe(before);
  });
});

// ---------------- R4-2 ----------------

describe("R4-2: overlapping pending proposals", () => {
  it("refuses a second pending change to the same field, so Ask and the scheduler keep the accepted date", async () => {
    await proposeDue("due-8", "2026-12-08");
    await expect(proposeDue("due-11", "2026-12-11")).rejects.toMatchObject({ code: "VALIDATION", details: [expect.objectContaining({ reason: "NEX-1 due already has a change awaiting review. Accept or reject it first." })] });
    expect(await nex1Due()).toEqual({ date: "2026-12-08" });
    expect(effectiveAcceptedIssues(service.listIssues(), engine.unsettledChanges())[0]!.due).toEqual({ date: "2026-12-05" });
    index = await SearchIndex.build(service);
    const asked = await makeAskTools(readOnlyWorkspace(service, index, engine), new HandleRegistry(), newConsulted()).query_issues({});
    expect(asked.issues[0]).toMatchObject({ due: { date: "2026-12-05" }, proposedPendingReview: { due: { date: "2026-12-08" } } });
    const [change] = await engine.views("open");
    await engine.reject(change!.changeId);
    expect(await nex1Due()).toEqual({ date: "2026-12-05" });
  });

  it("refuses a note edit to lines that another pending change wrote", async () => {
    const note = await service.readNote(NOTE);
    await engine.propose(source, [{ opId: "tick", kind: "note.replaceSpan", file: NOTE, baseRevision: note.revision, before: "- [ ] Hein builds the calendar view\n", after: "- [x] Hein builds the calendar view\n" }], "agent");
    const now = await service.readNote(NOTE);
    await expect(engine.propose(source, [{ opId: "retick", kind: "note.replaceSpan", file: NOTE, baseRevision: now.revision, before: "- [x] Hein builds the calendar view\n", after: "- [x] Hein builds the calendar view (done)\n" }], "agent"))
      .rejects.toMatchObject({ details: [expect.objectContaining({ reason: "These lines have another change awaiting review. Accept or reject it first." })] });
    expect(await read(NOTE)).toBe(now.content);
  });

  it("reconstructs the accepted value when an older journal holds two open changes to one field, whichever was made first", () => {
    const issue = { ...service.listIssues()[0]!, due: { date: "2026-12-11" } } as Issue;
    const change = (before: string, after: string): ChangeRecord => ({
      changeId: "chg_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", opId: `${before}-${after}`, kind: "record.updateField", file: ".nexus/issues.json",
      target: { recordId: issue.id, recordKey: "NEX-1", field: "due" }, baseRevision: 1, before: { date: before }, after: { date: after },
      context: null, dependsOn: [], supersedes: null, state: "pending", conflictReason: null, reversal: null, feedback: null, history: [],
    });
    expect(effectiveAcceptedIssues([issue], [change("2026-12-05", "2026-12-08"), change("2026-12-08", "2026-12-11")])[0]!.due).toEqual({ date: "2026-12-05" });
  });
});

// ---------------- R4-3 ----------------

describe("R4-3: a change cannot be accepted when what it needs was never written", () => {
  async function partial() {
    let hits = 0;
    setFaultInjector((p) => { if (p === "review:write:.nexus/issues.json" && ++hits === 1) throw new Error("Simulated locked issues file"); });
    const r = await proposeJ7("lock");
    setFaultInjector(null);
    expect(r.outcome.phase).toBe("partial");
    expect(await read(NOTE)).toContain("(NEX-2)");
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
    return r;
  }

  it("refuses to accept the note line, and Discard first undoes it after confirmation", async () => {
    const { outcome, line } = await partial();
    await expect(engine.accept(line.changeId)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "dependency-unavailable" } });
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toMatchObject({ details: { reason: "dependency-unavailable" } });
    await expect(engine.discard(outcome.runId!)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "has-dependents", changes: [expect.objectContaining({ changeId: line.changeId })] } });
    await engine.discard(outcome.runId!, { withDependents: true });
    await reopen();
    expect(await states()).toEqual(["note.replaceSpan rejected", "record.addLink rejected", "record.create rejected"]);
    expect(await read(NOTE)).toContain(LINE);
    expect(await read(NOTE)).not.toContain("NEX-2");
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
  });

  it("after Retry writes the issue, the line is accepted together with it", async () => {
    const { outcome, line } = await partial();
    await reopen(); // a restart writes nothing by itself
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
    await engine.retry(outcome.runId!);
    await expect(engine.accept(line.changeId)).rejects.toMatchObject({ details: { reason: "needs-dependencies" } });
    await engine.accept(line.changeId, { withDependencies: true });
    expect(await states()).toEqual(["note.replaceSpan accepted", "record.addLink pending", "record.create accepted"]);
  });
});

// ---------------- R4-7 ----------------

describe("R4-7: a proposed issue's key is never given to another issue", () => {
  it("reserves the number, so after a rejection the next issue is NEX-3, and the old key says what happened", async () => {
    const { create } = await proposeJ7("keys");
    expect(ProjectsFile.parse(JSON.parse(await read(".nexus/projects.json"))).projects[0]!.nextIssueNumber).toBe(3);
    await engine.reject(create.changeId, { withDependents: true });
    const project = service.listProjects()[0]!;
    const next = await service.createIssue({ projectId: project.id, title: "Book venue lighting" });
    expect(next.key).toBe("NEX-3");
    expect(engine.proposedIssue("NEX-2")).toMatchObject({ key: "NEX-2", title: "Write the judge instructions", state: "rejected" });
    expect(engine.proposedIssue("NEX-3")).toBeNull();
  });
});

// ---------------- R4-9 ----------------

describe("R4-9: dependencies across runs, and decisions interrupted part-way", () => {
  it("refuses a proposal in another run that builds on a new issue still awaiting review", async () => {
    await proposeJ7("first");
    const nex2 = service.listIssues().find((i) => i.key === "NEX-2")!;
    const before = { note: await read(NOTE), issues: await read(".nexus/issues.json") };
    const note = await service.readNote(NOTE);
    const refused = (ops: ProposedOperation[]) => expect(engine.propose(source, ops, "agent")).rejects.toMatchObject({ details: [expect.objectContaining({ reason: expect.stringMatching(/NEX-2 is a new issue that is still awaiting review/) })] });
    await refused([{ opId: "x-link", kind: "record.addLink", file: ".nexus/issues.json", recordKey: "NEX-2", baseRevision: nex2.revision, link: { notePath: NOTE, headingSlug: "decisions", headingText: null } }]);
    await refused([{ opId: "x-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-2", field: "due", baseRevision: nex2.revision, before: null, after: { date: "2026-12-03" } }]);
    await refused([{ opId: "x-line", kind: "note.replaceSpan", file: NOTE, baseRevision: note.revision, before: "- Every agent edit is reviewed one change at a time.\n", after: "- Every agent edit is reviewed one change at a time (see NEX-2).\n" }]);
    expect({ note: await read(NOTE), issues: await read(".nexus/issues.json") }).toEqual(before);
  });

  it("finishes a confirmed “Reject all” that stopped after its first undo", async () => {
    const { create } = await proposeJ7("rej");
    setFaultInjector((p) => { if (p === "review:after-reversal-write") throw new InjectedFault(p); });
    await expect(engine.reject(create.changeId, { withDependents: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await reopen();
    expect(await states()).toEqual(["note.replaceSpan rejected", "record.addLink rejected", "record.create rejected"]);
    expect(await read(NOTE)).toContain(LINE);
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
    expect((await engine.views("all")).every((v) => v.state === "rejected")).toBe(true);
  });

  it("finishes a confirmed “Accept both” that stopped before any change was marked", async () => {
    const { line } = await proposeJ7("acc");
    setFaultInjector((p) => { if (p === "review:after-group-decision") throw new InjectedFault(p); });
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await reopen();
    expect(await states()).toEqual(["note.replaceSpan accepted", "record.addLink pending", "record.create accepted"]);
  });
});
