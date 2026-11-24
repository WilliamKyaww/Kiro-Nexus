// The first Edit journey's operations in the review journal: a new issue, a link from it to its
// source heading, and a note line that mentions it ({{issue:…}}), with dependencies between
// them. Every check reads the real files of a disposable copy of the fictional sample.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, type ProposedOperation } from "@nexus/schema";
import { InjectedFault, setFaultInjector } from "../faults";
import { effectiveAcceptedIssues } from "../scheduler/reminders";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { ReviewEngine } from "./engine";

const NOTE = "meetings/2026-11-24 kickoff.md";
const LINE = "- [ ] Will writes the judge instructions\n";
let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (fixture, not AI)" };
const noteText = () => readFile(join(ws, ...NOTE.split("/")), "utf8");
const issues = async () => IssuesFile.parse(JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"))).issues;
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `create-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};

async function propose(prefix = "j7") {
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

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-create-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("a new issue, its link and the note line, as one reviewed run", () => {
  it("writes all three tentatively, with the new key in the note, and records the dependencies", async () => {
    const { outcome, create, link, line } = await propose();
    expect(outcome.phase).toBe("applied");
    const nex2 = (await issues()).find((i) => i.key === "NEX-2")!;
    expect(nex2).toMatchObject({ title: "Write the judge instructions", status: "todo", noteLinks: [{ notePath: NOTE, headingSlug: "actions", headingText: "Actions" }] });
    expect(await noteText()).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
    expect(create).toMatchObject({ state: "pending", recordKey: "NEX-2", summary: "New issue NEX-2: Write the judge instructions", dependsOn: [] });
    expect(create.dependents.sort()).toEqual([link.changeId, line.changeId].sort());
    expect(link).toMatchObject({ summary: "NEX-2 link to meetings/2026-11-24 kickoff › Actions", dependsOn: [create.changeId] });
    expect(line.dependsOn).toEqual([create.changeId]);
    // While pending, the new issue and its link are not accepted data (architecture 7.7).
    expect(effectiveAcceptedIssues(service.listIssues(), engine.unsettledChanges()).map((i) => i.key)).toEqual(["NEX-1"]);
  });

  it("asks before rejecting the new issue together with what depends on it, then undoes all three", async () => {
    const { create, link, line } = await propose();
    // An unrelated manual edit elsewhere in the note, and on NEX-1, made while the run is pending.
    const note = await service.readNote(NOTE);
    await service.saveNote(NOTE, note.content.replace("- Which free model route", "- Which free (fictional) model route"), note.revision);
    await service.updateIssue("NEX-1", 1, { title: "Build the month calendar" });
    await expect(engine.reject(create.changeId)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "has-dependents", changes: expect.arrayContaining([expect.objectContaining({ changeId: link.changeId }), expect.objectContaining({ changeId: line.changeId })]) } });
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1", "NEX-2"]); // nothing happened
    expect(await engine.reject(create.changeId, { withDependents: true })).toMatchObject({ state: "rejected" });
    const after = await engine.views("all");
    expect(after.filter((v) => [create.changeId, link.changeId, line.changeId].includes(v.changeId)).map((v) => v.state)).toEqual(["rejected", "rejected", "rejected"]);
    expect((await issues()).map((i) => [i.key, i.title])).toEqual([["NEX-1", "Build the month calendar"]]);
    const text = await noteText();
    expect(text).toContain(LINE);
    expect(text).not.toContain("NEX-2");
    expect(text).toContain("- Which free (fictional) model route"); // the manual edit is kept
  });

  it("accepts a dependent change only together with the new issue it needs", async () => {
    const { create, link, line } = await propose();
    await expect(engine.accept(link.changeId)).rejects.toMatchObject({ details: { reason: "needs-dependencies", changes: [expect.objectContaining({ changeId: create.changeId })] } });
    await engine.accept(link.changeId, { withDependencies: true });
    const v = await engine.views("all");
    expect(v.find((x) => x.changeId === create.changeId)?.state).toBe("accepted");
    expect(v.find((x) => x.changeId === link.changeId)?.state).toBe("accepted");
    // The note line can still be decided on its own: rejecting it restores the line only.
    await engine.reject(line.changeId);
    expect(await noteText()).toContain(LINE);
    expect((await issues()).find((i) => i.key === "NEX-2")?.noteLinks).toHaveLength(1);
  });

  it("keeps a new issue that someone has worked on since, instead of deleting it", async () => {
    const { create } = await propose();
    await service.updateIssue("NEX-2", 2, { description: "Draft by hand." });
    await engine.reject(create.changeId, { withDependents: true });
    expect((await engine.views("all")).find((v) => v.changeId === create.changeId)).toMatchObject({ state: "conflicted", conflictReason: "changed" });
    expect((await issues()).find((i) => i.key === "NEX-2")?.description).toBe("Draft by hand.");
  });

  it("survives a restart while pending, and a crash between its two file writes", async () => {
    const { create } = await propose("first");
    await service.close();
    await open();
    expect((await engine.views("open")).map((v) => v.state)).toEqual(["pending", "pending", "pending"]);
    await engine.reject(create.changeId, { withDependents: true });

    // A crash after the note is written but before issues.json: recovery rolls the run forward.
    let hits = 0;
    setFaultInjector((p) => { if (p === "review:after-file-write" && ++hits === 1) throw new InjectedFault(p); });
    await expect(propose("second")).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await service.close();
    await open();
    const open2 = await engine.views("open");
    expect(open2.map((v) => [v.kind, v.state])).toEqual([["note.replaceSpan", "pending"], ["record.create", "pending"], ["record.addLink", "pending"]]);
    // The rejected first proposal's NEX-2 is never given to another issue (R4-7).
    expect((await issues()).find((i) => i.key === "NEX-2")).toBeUndefined();
    expect((await issues()).find((i) => i.key === "NEX-3")).toMatchObject({ title: "Write the judge instructions" });
    expect(await noteText()).toContain("(NEX-3)");
  });

  it("refuses a note edit or link that refers to an issue the proposal does not create, and writes nothing", async () => {
    const note = await service.readNote(NOTE);
    const before = await noteText();
    await expect(engine.propose(source, [
      { opId: "bad-line", kind: "note.replaceSpan", file: NOTE, baseRevision: note.revision, before: LINE, after: "- [ ] Will writes the judge instructions ({{issue:nope}})\n" },
    ], "agent")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(engine.propose(source, [
      { opId: "bad-link", kind: "record.addLink", file: ".nexus/issues.json", recordKey: "NEX-1", link: { notePath: NOTE, headingSlug: "no-such-heading", headingText: null } },
    ], "agent")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await noteText()).toBe(before);
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
  });
});
