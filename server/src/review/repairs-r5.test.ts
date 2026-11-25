// Run 6, stage 1: regression tests for the journal findings of the independent run-5 review
// (reviewer: Astra 6.2 in the Codex extension, run by Will). Each test follows the reviewer's
// reproduction on a disposable copy of the fictional sample and reads the real files.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ProjectsFile, serialise, type ProposedOperation } from "@nexus/schema";
import { toProposedOperations } from "../ask/edit";
import { HandleRegistry } from "../ask/handles";
import { makeAskTools, newConsulted } from "../ask/tools";
import { readOnlyWorkspace } from "../ask/workspace";
import { InjectedFault, setFaultInjector } from "../faults";
import { SearchIndex } from "../notes/search";
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
const write = (rel: string, text: string) => writeFile(join(ws, ...rel.split("/")), text, "utf8");
const issues = async () => IssuesFile.parse(JSON.parse(await read(".nexus/issues.json"))).issues;
const open = async () => {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `r5-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
};
const close = async () => { index?.dispose(); index = null; await service.close(); };
const reopen = async () => { await close(); await open(); };
const stateOf = async (changeId: string) => (await engine.views("all")).find((v) => v.changeId === changeId)!.state;

async function askTools() {
  index = await SearchIndex.build(service);
  const wsr = readOnlyWorkspace(service, index, engine);
  const consulted = newConsulted();
  return { wsr, consulted, tools: makeAskTools(wsr, new HandleRegistry(), consulted) };
}

async function proposeJ7(prefix: string) {
  const note = await service.readNote(NOTE);
  const ops: ProposedOperation[] = [
    { opId: `${prefix}-create`, kind: "record.create", file: ".nexus/issues.json", projectKey: "NEX", title: "Write the judge instructions" },
    { opId: `${prefix}-link`, kind: "record.addLink", file: ".nexus/issues.json", issueRef: `${prefix}-create`, link: { notePath: NOTE, headingSlug: "actions", headingText: null } },
    { opId: `${prefix}-line`, kind: "note.replaceSpan", file: NOTE, baseRevision: note.revision, before: LINE, after: `- [ ] Will writes the judge instructions ({{issue:${prefix}-create}})\n` },
  ];
  const outcome = await engine.propose(source, ops, "agent");
  const byKind = (kind: string) => outcome.changes.find((c) => c.kind === kind)!;
  return { create: byKind("record.create"), link: byKind("record.addLink"), line: byKind("note.replaceSpan") };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-r5-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await close(); await rm(base, { recursive: true, force: true }); });

describe("R5-1: a span's identity is not established by a sole occurrence elsewhere", () => {
  const week = "# Week plan\n\nFictional sample data.\n\n## Monday\n\nDraft it.\n\n## Tuesday\n\nPublish it.\n";
  it("rejecting a change whose lines were edited by hand is a conflict, and Tuesday is untouched (the reviewer's case)", async () => {
    const created = await service.createNote(PLAN, week);
    const out = await engine.propose(source, [{ opId: "mon", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "Draft it.\n", after: "Publish it.\n" }], "agent");
    const change = out.changes[0]!;
    const pending = await service.readNote(PLAN);
    // Change Monday by hand. "Publish it." is now only in Tuesday.
    await service.saveNote(PLAN, pending.content.replace("## Monday\n\nPublish it.", "## Monday\n\nManually revised."), pending.revision);
    const { tools } = await askTools();
    expect(await tools.read_note_section({ path: PLAN, headingSlug: "tuesday" })).toMatchObject({ text: "Publish it." });
    await engine.reject(change.changeId);
    expect(await stateOf(change.changeId)).toBe("conflicted");
    const disk = await read(PLAN);
    expect(disk).toContain("## Monday\n\nManually revised.\n");
    expect(disk).toContain("## Tuesday\n\nPublish it.\n");
    expect(disk).not.toContain("Draft it.");
  });

  it("still reverses a span whose neighbouring line was edited on one side only", async () => {
    const created = await service.createNote(PLAN, week);
    const out = await engine.propose(source, [{ opId: "mon2", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "Draft it.\n", after: "Draft it today.\n" }], "agent");
    const pending = await service.readNote(PLAN);
    await service.saveNote(PLAN, pending.content.replace("## Tuesday", "## Tuesday (moved)"), pending.revision);
    await engine.reject(out.changes[0]!.changeId);
    expect(await stateOf(out.changes[0]!.changeId)).toBe("rejected");
    expect(await read(PLAN)).toContain("## Monday\n\nDraft it.\n\n## Tuesday (moved)\n\nPublish it.\n");
  });
});

describe("R5-2: recovery revalidates a saved group decision against the files", () => {
  it("Accept both: a new issue removed by hand while closed is not recorded as accepted, nor is its link", async () => {
    const { create, link, line } = await proposeJ7("r52a");
    setFaultInjector((p) => { if (p === "review:after-group-decision") throw new InjectedFault(p); });
    await expect(engine.accept(line.changeId, { withDependencies: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await close();
    const file = IssuesFile.parse(JSON.parse(await read(".nexus/issues.json")));
    await write(".nexus/issues.json", serialise(IssuesFile, { ...file, issues: file.issues.filter((i) => i.key !== "NEX-2") }));
    await open();
    expect((await issues()).map((i) => i.key)).toEqual(["NEX-1"]);
    for (const c of [create, link, line]) expect(await stateOf(c.changeId)).not.toBe("accepted");
    expect(await stateOf(create.changeId)).toBe("conflicted");
    expect(await stateOf(line.changeId)).toBe("pending");
    // The line can still be rejected, which restores the original text.
    await engine.reject(line.changeId);
    expect(await read(NOTE)).toContain(LINE);
  });

  it("Reject all: when the new issue was edited by hand while closed, its dependents stay as they were and the root is a conflict", async () => {
    const { create, link, line } = await proposeJ7("r52b");
    setFaultInjector((p) => { if (p === "review:after-group-decision") throw new InjectedFault(p); });
    await expect(engine.reject(create.changeId, { withDependents: true })).rejects.toBeInstanceOf(InjectedFault);
    setFaultInjector(null);
    await close();
    const file = IssuesFile.parse(JSON.parse(await read(".nexus/issues.json")));
    await write(".nexus/issues.json", serialise(IssuesFile, { ...file, issues: file.issues.map((i) => (i.key === "NEX-2" ? { ...i, title: "Write the judge instructions (edited by Will)", revision: i.revision + 1 } : i)) }));
    await open();
    expect(await stateOf(create.changeId)).toBe("conflicted");
    expect(await stateOf(link.changeId)).toBe("pending");
    expect(await stateOf(line.changeId)).toBe("pending");
    expect((await issues()).find((i) => i.key === "NEX-2")?.title).toBe("Write the judge instructions (edited by Will)");
    expect(await read(NOTE)).toContain("(NEX-2)");
  });
});

describe("R5-7: a key proposed in an older workspace is never given to another issue", () => {
  it("a run-4 workspace whose counter was not advanced still skips its rejected NEX-2", async () => {
    const { create } = await proposeJ7("r57");
    await engine.reject(create.changeId, { withDependents: true });
    await close();
    // Run 4 did not reserve proposal numbers: put the counter back as it would have been.
    const projects = ProjectsFile.parse(JSON.parse(await read(".nexus/projects.json")));
    await write(".nexus/projects.json", serialise(ProjectsFile, { ...projects, projects: projects.projects.map((p) => ({ ...p, nextIssueNumber: 2 })) }));
    await open();
    const project = service.listProjects().find((p) => p.key === "NEX")!;
    const made = await service.createIssue({ projectId: project.id, title: "Book venue lighting" });
    expect(made.key).toBe("NEX-3");
  });

  it("an issue that already reused a proposal's key says so", async () => {
    const { create } = await proposeJ7("r57b");
    await engine.reject(create.changeId, { withDependents: true });
    // Simulate the reuse a run-4 workspace could already contain.
    const file = IssuesFile.parse(JSON.parse(await read(".nexus/issues.json")));
    const nex1 = file.issues[0]!;
    await close();
    await write(".nexus/issues.json", serialise(IssuesFile, { ...file, issues: [...file.issues, { ...nex1, id: "iss_01JD3M8Q4K7Y2C9X5V6B1N0RZZ", key: "NEX-2", title: "Book venue lighting", noteLinks: [], rank: "a1" }] }));
    await open();
    expect(engine.proposedIssue("NEX-2")).toMatchObject({ title: "Write the judge instructions", state: "rejected", reusedBy: "Book venue lighting" });
  });
});

describe("R5-8: an Edit's scope is exactly the lines a read returned", () => {
  it("a truncated read registers only the returned lines, and further lines need another read", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `- Item ${String(i + 1).padStart(3, "0")} is fictional sample text`).join("\n");
    await service.createNote(PLAN, `# Week plan\n\n## Backlog\n\n${long}\n\n## Done\n\n- Nothing yet\n`);
    const { wsr, consulted, tools } = await askTools();
    const first = await tools.read_note_section({ path: PLAN, headingSlug: "backlog" }) as { text: string; truncated: boolean; nextFromLine?: number };
    expect(first.truncated).toBe(true);
    expect(first.text.length).toBeLessThanOrEqual(6000);
    const unseen = "- Item 400 is fictional sample text";
    expect(first.text).not.toContain(unseen);
    const refused = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "backlog", before: unseen, after: "- Item 400 is done" }], wsr, "r58", consulted.reads);
    expect(refused).toMatchObject({ error: expect.stringMatching(/not in the part of the section you read/) });
    let from = first.nextFromLine;
    while (from !== undefined) {
      const part = await tools.read_note_section({ path: PLAN, headingSlug: "backlog", fromLine: from }) as { text: string; nextFromLine?: number };
      from = part.nextFromLine;
    }
    const mapped = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "backlog", before: unseen, after: "- Item 400 is done" }], wsr, "r58b", consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    await engine.propose(source, mapped.operations, "agent");
    expect(await read(PLAN)).toContain("- Item 400 is done\n");
  });

  it("a change to the heading line after the read is refused, though the slug and body are the same", async () => {
    await service.createNote(PLAN, "# Week plan\n\n## Monday\n\n- Draft the agenda\n");
    const { wsr, consulted, tools } = await askTools();
    await tools.read_note_section({ path: PLAN, headingSlug: "monday" });
    const mapped = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "monday", before: "- Draft the agenda", after: "- Send the agenda" }], wsr, "r58c", consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    const now = await service.readNote(PLAN);
    await service.saveNote(PLAN, now.content.replace("## Monday", "### Monday"), now.revision);
    const fresh = await service.readNote(PLAN);
    const ops = mapped.operations.map((o) => ({ ...o, baseRevision: fresh.revision }));
    await expect(engine.propose(source, ops, "agent")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await read(PLAN)).toContain("- Draft the agenda");
  });
});

describe("R5-9: a note conflict whose lines cannot be located blocks edits to that region", () => {
  it("refuses a new edit on the line of an unresolved conflict (the reviewer's case)", async () => {
    const created = await service.createNote(PLAN, "# Week plan\n\n## Tasks\n\nBook desk.\n\nOrder chairs.\n");
    const first = await engine.propose(source, [{ opId: "desk", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "Book desk.\n", after: "Book room.\n" }], "agent");
    const pending = await service.readNote(PLAN);
    await service.saveNote(PLAN, pending.content.replace("Book room.", "Book lounge."), pending.revision);
    await engine.reject(first.changes[0]!.changeId);
    expect(await stateOf(first.changes[0]!.changeId)).toBe("conflicted");
    const now = await service.readNote(PLAN);
    await expect(engine.propose(source, [{ opId: "hall", kind: "note.replaceSpan", file: PLAN, baseRevision: now.revision, before: "Book lounge.\n", after: "Book hall.\n" }], "agent"))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect(await read(PLAN)).toContain("Book lounge.");
    // An edit elsewhere in the note is still possible.
    await engine.propose(source, [{ opId: "chairs", kind: "note.replaceSpan", file: PLAN, baseRevision: now.revision, before: "Order chairs.\n", after: "Order more chairs.\n" }], "agent");
    expect(await read(PLAN)).toContain("Order more chairs.");
  });
});

describe("R5-10: a citation records the text it read in its section", () => {
  it("keeps the first line of the section as the citation's excerpt", async () => {
    await service.createNote(PLAN, "# Day\n\n## Tasks\n\nDeliver parcels.\n- Collect keys\n");
    index = await SearchIndex.build(service);
    const handles = new HandleRegistry();
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), handles, newConsulted());
    const r = await tools.read_note_section({ path: PLAN, headingSlug: "tasks" }) as { handle: string };
    expect(handles.get(r.handle)?.target).toMatchObject({ kind: "note", headingSlug: "tasks", excerpt: "Deliver parcels." });
  });
});

describe("R5-10: a renamed heading that duplicates another one is reported as uncertain", () => {
  it("a decided change from before run 5 that renamed Alpha to the name of Beta marks Beta's links as uncertain", async () => {
    const created = await service.createNote(PLAN, "# Plan\n\n## Alpha\n\nSet chairs.\n\n## Beta\n\nDeliver parcels.\n");
    const out = await engine.propose(source, [{ opId: "ab", kind: "note.replaceSpan", file: PLAN, baseRevision: created.revision, before: "## Alpha\n", after: "## Beta\n" }], "agent");
    await engine.accept(out.changes[0]!.changeId);
    // Make the decided change look like one from run 4, which recorded no slug moves.
    await close();
    const names = (await import("node:fs/promises")).readdir;
    const dir = join(ws, ".nexus", "reviews");
    for (const name of await names(dir)) {
      const run = JSON.parse(await readFile(join(dir, name), "utf8"));
      for (const c of run.changes) delete c.slugMoves;
      await writeFile(join(dir, name), JSON.stringify(run, null, 2) + "\n");
    }
    await open();
    const disk = await read(PLAN);
    const aliases = engine.headingAliases(PLAN, disk);
    expect(aliases).toContainEqual(expect.objectContaining({ slug: "beta", reason: "uncertain", ref: "accepted" }));
  });
});
