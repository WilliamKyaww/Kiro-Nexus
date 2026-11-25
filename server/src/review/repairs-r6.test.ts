// R6 repairs: regression tests for the journal findings R6-1 and R6-2 of the independent run-6
// review (reviewer: Astra 6.2 in the Codex extension, run by Will). Each test follows the
// reviewer's reproduction on a disposable copy of the fictional sample, through the production
// read tool, the scoped Edit mapper and the journal, and reads the real files.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ReviewRun } from "@nexus/schema";
import { toProposedOperations, type AgentOperation } from "../ask/edit";
import { HandleRegistry } from "../ask/handles";
import { makeAskTools, newConsulted } from "../ask/tools";
import { readOnlyWorkspace } from "../ask/workspace";
import { InjectedFault, setFaultInjector } from "../faults";
import { SearchIndex } from "../notes/search";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { ReviewEngine } from "./engine";

const PLAN = "plans/week plan.md";
const NOTE = "meetings/2026-11-24 kickoff.md";
let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let index: SearchIndex | null = null;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (test double, not AI)" };
const read = (rel: string) => readFile(join(ws, ...rel.split("/")), "utf8");
const write = (rel: string, text: string) => writeFile(join(ws, ...rel.split("/")), text, "utf8");
const issues = async () => IssuesFile.parse(JSON.parse(await read(".nexus/issues.json"))).issues;
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `r6-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};
const close = async () => { index?.dispose(); index = null; await service.close(); };
const view = async (changeId: string) => (await engine.views("all")).find((v) => v.changeId === changeId)!;

/** Fresh read tools on the current files, as one Edit run has them. */
async function askTools() {
  index?.dispose();
  index = await SearchIndex.build(service);
  const wsr = readOnlyWorkspace(service, index, engine);
  const consulted = newConsulted();
  return { wsr, consulted, tools: makeAskTools(wsr, new HandleRegistry(), consulted) };
}

/** Read the named sections, map the model's operations with the scoped Edit mapper, and propose them. */
async function editRun(prefix: string, sections: Array<{ path: string; headingSlug: string | null }>, ops: AgentOperation[]) {
  const { wsr, consulted, tools } = await askTools();
  for (const s of sections) await tools.read_note_section({ path: s.path, headingSlug: s.headingSlug });
  const mapped = await toProposedOperations(ops, wsr, prefix, consulted.reads);
  if ("error" in mapped) throw new Error(mapped.error);
  return engine.propose(source, mapped.operations, "agent");
}

async function saveByHand(path: string, from: string, to: string) {
  const now = await service.readNote(path);
  expect(now.content).toContain(from);
  await service.saveNote(path, now.content.replace(from, to), now.revision);
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-r6-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await close(); await rm(base, { recursive: true, force: true }); });

describe("R6-1: a note change is found again only in its own section", () => {
  const week = "# Week plan\n\nFictional sample data.\n\n## Monday\n\nChecklist\nDraft it.\n\n## Tuesday\n\nChecklist\nPublish it.\n\n## Friday\n\nOrder snacks.\n";

  it("Reject after a hand revision is a conflict, Tuesday is untouched, and Ask still reads Tuesday as it is (the reviewer's case)", async () => {
    await service.createNote(PLAN, week);
    const out = await editRun("r61a", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Draft it.", after: "Publish it." }]);
    const change = out.changes[0]!;
    expect(await read(PLAN)).toContain("## Monday\n\nChecklist\nPublish it.\n\n## Tuesday\n\nChecklist\nPublish it.\n");
    // Will revises Monday's proposed line by hand. "Publish it." is now only in Tuesday.
    await saveByHand(PLAN, "## Monday\n\nChecklist\nPublish it.", "## Monday\n\nChecklist\nPublish it after the review.");
    // The accepted text Ask reads keeps Tuesday as it is on disk.
    const { tools } = await askTools();
    const tuesday = await tools.read_note_section({ path: PLAN, headingSlug: "tuesday" }) as { text: string };
    expect(tuesday.text).toContain("Publish it.");
    expect(tuesday.text).not.toContain("Draft it.");
    expect((await view(change.changeId)).lines).toBeNull();
    await engine.reject(change.changeId);
    expect((await view(change.changeId)).state).toBe("conflicted");
    const disk = await read(PLAN);
    expect(disk).toContain("## Monday\n\nChecklist\nPublish it after the review.\n");
    expect(disk).toContain("## Tuesday\n\nChecklist\nPublish it.\n");
    expect(disk).not.toContain("Draft it.");
  });

  it("an unlocatable change blocks new edits in its own section only: an edit under Friday is still proposed", async () => {
    await service.createNote(PLAN, week);
    const out = await editRun("r61b", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Draft it.", after: "Draft Monday's notes." }]);
    await saveByHand(PLAN, "Draft Monday's notes.", "Draft Monday's notes by noon.");
    expect((await view(out.changes[0]!.changeId)).lines).toBeNull();
    // Monday: refused, because Nexus cannot tell which of its lines the change still covers.
    await expect(editRun("r61c", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Checklist", after: "Checklist for Monday" }]))
      .rejects.toMatchObject({ code: "VALIDATION" });
    // Friday is another section: the edit is written.
    const friday = await editRun("r61d", [{ path: PLAN, headingSlug: "friday" }], [{ op: "edit_note", note: PLAN, heading: "friday", before: "Order snacks.", after: "Order fruit." }]);
    expect(friday.changes[0]!.state).toBe("pending");
    expect(await read(PLAN)).toContain("## Friday\n\nOrder fruit.\n");
    expect(await read(PLAN)).toContain("Draft Monday's notes by noon.");
  });

  it("an edit whose new lines would repeat other lines of its section is refused, so the change can always be found again", async () => {
    await service.createNote(PLAN, "# Week plan\n\n## Monday\n\nChecklist\nPublish it.\nChecklist\nDraft it.\n\n## Tuesday\n\nRest.\n");
    await expect(editRun("r61e", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Draft it.", after: "Publish it." }]))
      .rejects.toMatchObject({ code: "VALIDATION", details: [expect.objectContaining({ reason: expect.stringMatching(/more than once in the section/) })] });
    expect(await read(PLAN)).toContain("Checklist\nDraft it.\n");
  });

  it("still reverses its own lines after a neighbouring line under the same heading was edited, and after Tuesday was renamed", async () => {
    await service.createNote(PLAN, week);
    const out = await editRun("r61f", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Draft it.", after: "Publish it." }]);
    await saveByHand(PLAN, "## Monday\n\nChecklist\n", "## Monday\n\nChecklist (revised)\n");
    await saveByHand(PLAN, "## Tuesday", "## Tuesday (moved)");
    await engine.reject(out.changes[0]!.changeId);
    expect((await view(out.changes[0]!.changeId)).state).toBe("rejected");
    expect(await read(PLAN)).toContain("## Monday\n\nChecklist (revised)\nDraft it.\n\n## Tuesday (moved)\n\nChecklist\nPublish it.\n");
  });

  it("an Edit that renames the heading of the section it read is still reversed by Reject", async () => {
    await service.createNote(PLAN, week);
    const out = await editRun("r61h", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "## Monday", after: "## Monday plan" }]);
    expect(await read(PLAN)).toContain("## Monday plan\n\nChecklist\nDraft it.\n");
    await engine.reject(out.changes[0]!.changeId);
    expect((await view(out.changes[0]!.changeId)).state).toBe("rejected");
    expect(await read(PLAN)).toBe(week);
  });

  it("follows its section when a later rejection moves the section's slug on disk", async () => {
    const created = await service.createNote(PLAN, week);
    // A fixed-demo rename gives Monday the name of Tuesday, so Tuesday is tuesday-1 on disk.
    const demo = await engine.propose({ kind: "fixed-demo", label: "Test rename (fixed, not AI)" }, [{ opId: "r61i-demo", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "## Monday\n", after: "## Tuesday\n" }], "demo");
    const out = await editRun("r61i", [{ path: PLAN, headingSlug: "tuesday" }], [{ op: "edit_note", note: PLAN, heading: "tuesday", before: "Publish it.", after: "Publish it today." }]);
    // Rejecting the rename gives the real Tuesday its slug back.
    await engine.reject(demo.changes[0]!.changeId);
    expect(await read(PLAN)).toContain("## Monday\n\nChecklist\nDraft it.\n\n## Tuesday\n\nChecklist\nPublish it today.\n");
    // Both neighbouring lines of the Edit change are then edited in place by hand.
    await saveByHand(PLAN, "## Tuesday\n\nChecklist\n", "## Tuesday\n\nChecklist (Tue)\n");
    await saveByHand(PLAN, "## Friday", "## Friday (moved)");
    await engine.reject(out.changes[0]!.changeId);
    expect((await view(out.changes[0]!.changeId)).state).toBe("rejected");
    expect(await read(PLAN)).toContain("## Monday\n\nChecklist\nDraft it.\n\n## Tuesday\n\nChecklist (Tue)\nPublish it.\n\n## Friday (moved)\n");
  });

  it("a change whose section heading was renamed by hand is found only with its neighbours intact, and otherwise conflicts", async () => {
    await service.createNote(PLAN, week);
    const out = await editRun("r61g", [{ path: PLAN, headingSlug: "monday" }], [{ op: "edit_note", note: PLAN, heading: "monday", before: "Draft it.", after: "Publish it." }]);
    await saveByHand(PLAN, "## Monday\n\nChecklist\nPublish it.", "## Monday (moved)\n\nChecklist\nPublish it after the review.");
    await engine.reject(out.changes[0]!.changeId);
    expect((await view(out.changes[0]!.changeId)).state).toBe("conflicted");
    expect(await read(PLAN)).toContain("## Tuesday\n\nChecklist\nPublish it.\n");
  });
});

describe("R6-2: a saved group decision accepts only what is still in the files", () => {
  const J7: AgentOperation[] = [
    { op: "create_issue", ref: "judge", project: "NEX", title: "Write the judge instructions" },
    { op: "link_issue", issue: "judge", note: NOTE, heading: "actions" },
    { op: "edit_note", note: NOTE, heading: "actions", before: "- [ ] Will writes the judge instructions", after: "- [ ] Will writes the judge instructions ({{issue:judge}})" },
  ];
  const proposeJ7 = async (prefix: string) => {
    const out = await editRun(prefix, [{ path: NOTE, headingSlug: "actions" }], J7);
    const byKind = (kind: string) => out.changes.find((c) => c.kind === kind)!;
    return { create: byKind("record.create"), link: byKind("record.addLink"), line: byKind("note.replaceSpan") };
  };

  it("recovery of an interrupted Accept both: a note line replaced while closed is a conflict, and nothing else is accepted (the reviewer's case)", async () => {
    const { create, link, line } = await proposeJ7("r62a");
    expect(await read(NOTE)).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
    setFaultInjector((p) => { if (p === "review:after-group-decision") throw new InjectedFault(p); });
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await close();
    const note = await read(NOTE);
    await write(NOTE, note.replace("- [ ] Will writes the judge instructions (NEX-2)", "Rehearsal moved upstairs."));
    await open();
    // The manual text survives, and the journal does not claim the note line was accepted.
    expect(await read(NOTE)).toContain("Rehearsal moved upstairs.");
    expect(await read(NOTE)).not.toContain("(NEX-2)");
    expect(await view(line.changeId)).toMatchObject({ state: "conflicted", conflictReason: "missing" });
    // The issue and its link were not accepted without the line; they wait for the user.
    expect((await view(create.changeId)).state).toBe("pending");
    expect((await view(link.changeId)).state).toBe("pending");
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1", "NEX-2"]);
    // No member keeps a saved decision, so nothing is completed again at the next start.
    const dir = join(ws, ".nexus", "reviews");
    for (const name of await (await import("node:fs/promises")).readdir(dir)) {
      const run = ReviewRun.parse(JSON.parse(await readFile(join(dir, name), "utf8")));
      for (const c of run.changes) expect(c.decision ?? null).toBeNull();
    }
    // The user can still decide each one: keep the manual line, then accept the issue and its link.
    await engine.keepCurrent(line.changeId);
    await engine.accept(link.changeId, { withDependencies: true });
    expect((await view(create.changeId)).state).toBe("accepted");
    expect((await view(link.changeId)).state).toBe("accepted");
  });

  it("Accept both in normal operation, after the note line was replaced by hand, accepts nothing and reports the conflict", async () => {
    const { create, link, line } = await proposeJ7("r62b");
    await saveByHand(NOTE, "- [ ] Will writes the judge instructions (NEX-2)", "Rehearsal moved upstairs.");
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "target-missing" } });
    expect((await view(line.changeId)).state).toBe("conflicted");
    expect((await view(create.changeId)).state).toBe("pending");
    expect((await view(link.changeId)).state).toBe("pending");
    expect(await read(NOTE)).toContain("Rehearsal moved upstairs.");
  });

  it("recovery still completes Accept both when every member is in the files", async () => {
    const { create, link, line } = await proposeJ7("r62c");
    setFaultInjector((p) => { if (p === "review:after-group-decision") throw new InjectedFault(p); });
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await close();
    await open();
    // The group is the line and the issue it needs; the link was not part of the decision.
    for (const c of [create, line]) expect((await view(c.changeId)).state).toBe("accepted");
    expect((await view(link.changeId)).state).toBe("pending");
  });
});
