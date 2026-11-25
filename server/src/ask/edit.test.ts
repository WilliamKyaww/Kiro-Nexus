// Run 4, milestone 5: Edit mode in the coordinator, against the deterministic provider double
// (a labelled fixture, not AI). Edit proposes typed operations through the review journal;
// Ask never receives the write tool.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProposedOperation } from "@nexus/schema";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { runAsk } from "./coordinator";
import { toProposedOperations } from "./edit";
import { HandleRegistry } from "./handles";
import { makeAskTools, newConsulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const KEY = "nexus-fake-edit-key-7c2d";
const NOTE = "meetings/2026-11-24 kickoff.md";
const KICKOFF = "Which action from the kickoff still has no issue?";
const EDIT = "Create the missing issue, link it to its source heading and update the note line.";
let double: ProviderDouble;
let base: string;
let ws: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;
let n = 0;

const profile = (model: string, toolCalling: "yes" | "no" = "yes") => ({
  id: "prf_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", name: "Test double", baseUrl: double.baseUrl, model, createdAt: "",
  capabilities: { toolCalling, structuredOutput: "yes" as const, testedAt: null, detail: null, fixture: true },
});
const propose = (ops: ProposedOperation[]) => engine.propose({ kind: "agent", label: "Edit by nexus-test-double (test double, not AI)", conversationId: null, model: "nexus-test-double" }, ops, "agent");
const history = [{ question: KICKOFF, answer: "“Will writes the judge instructions” has no matching issue. “Hein builds the calendar view” is tracked by NEX-1." }];
const run = (question: string, authority: "ask" | "edit", model = "nexus-test-double", toolCalling: "yes" | "no" = "yes") =>
  runAsk({
    workspace: readOnlyWorkspace(service, index, engine), question, profile: profile(model, toolCalling), key: KEY, receivingHost: `127.0.0.1:${double.port}`,
    authority, ...(authority === "edit" ? { propose, history } : {}), opPrefix: `op-test-${++n}`,
  });
const note = () => readFile(join(ws, NOTE), "utf8");
const issuesFile = async () => JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).issues as Array<{ key: string; title: string; noteLinks: Array<{ headingSlug: string | null }> }>;
const texts = (items: Array<{ text: string }>) => items.map((i) => i.text).join("\n");
const offeredTools = (from: number) => double.requests.slice(from).flatMap((r) => ((r.body as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map((t) => t.function.name));

beforeAll(async () => { double = await startProviderDouble(); });
afterAll(async () => { await double.close(); });
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-edit-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `e-${++n}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("Edit mode", () => {
  it("proposes the missing issue, its heading link and the note line as three pending changes", async () => {
    const from = double.requests.length;
    const r = await run(EDIT, "edit");
    expect(r.authority).toBe("edit");
    expect(offeredTools(from)).toContain("propose_changes");
    expect(r.edit?.changes.map((c) => c.kind).sort()).toEqual(["note.replaceSpan", "record.addLink", "record.create"]);
    expect(r.edit?.changes.every((c) => c.state === "pending")).toBe(true);
    const create = r.edit!.changes.find((c) => c.kind === "record.create")!;
    expect(create.summary).toBe("New issue NEX-2: Write the judge instructions");
    // The link and the note line depend on the new issue (architecture 7.1).
    for (const c of r.edit!.changes.filter((x) => x.kind !== "record.create")) expect(c.dependsOn).toEqual([create.changeId]);
    expect(await note()).toContain("- [ ] Will writes the judge instructions (NEX-2)\n");
    const nex2 = (await issuesFile()).find((i) => i.key === "NEX-2")!;
    expect(nex2.title).toBe("Write the judge instructions");
    expect(nex2.noteLinks).toEqual([expect.objectContaining({ notePath: NOTE, headingSlug: "actions", headingText: "Actions" })]);
    // The answer reports proposals, never "done", and the grounded tracking still describes accepted data.
    expect(texts(r.answer.suggestions)).toMatch(/Proposed for your review: New issue NEX-2: Write the judge instructions\./);
    expect(texts(r.answer.facts)).toMatch(/Will writes the judge instructions.*has no matching issue/);
    const views = await engine.views("open");
    expect(views.map((v) => v.sourceLabel)).toEqual(Array(3).fill("Edit by nexus-test-double (test double, not AI)"));
  });

  it("leaves a pending new issue out of Ask's records until it is accepted, then Ask finds NEX-2", async () => {
    await run(EDIT, "edit");
    const pending = await run(KICKOFF, "ask");
    expect(texts(pending.answer.facts)).toMatch(/Will writes the judge instructions.*has no matching issue/);
    const create = (await engine.views("open")).find((v) => v.kind === "record.create")!;
    await engine.accept(create.changeId);
    for (const v of await engine.views("open")) await engine.accept(v.changeId);
    const accepted = await run(KICKOFF, "ask");
    expect(texts(accepted.answer.facts)).toMatch(/Will writes the judge instructions.*tracked by NEX-2/);
    expect(texts(accepted.answer.facts)).toMatch(/Hein builds the calendar view.*tracked by NEX-1/);
  });

  it("never offers the write tool to an Ask run, and refuses a write attempt", async () => {
    const before = { note: await note(), issues: await readFile(join(ws, ".nexus", "issues.json"), "utf8") };
    const from = double.requests.length;
    const r = await run(KICKOFF, "ask", "nexus-test-double-writer");
    expect(offeredTools(from)).not.toContain("propose_changes");
    expect(r.rejectedToolCalls).toEqual(["propose_changes"]);
    expect(r.edit).toBeNull();
    expect(await engine.views("all")).toEqual([]);
    expect({ note: await note(), issues: await readFile(join(ws, ".nexus", "issues.json"), "utf8") }).toEqual(before);
  });

  it("refuses Edit for a model without tool calling, before anything is sent or written", async () => {
    const from = double.requests.length;
    await expect(run(EDIT, "edit", "nexus-test-double-structured", "no")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(double.requests.length).toBe(from);
    expect(await engine.views("all")).toEqual([]);
  });

  it("returns an invalid proposal to the model with the reason and writes nothing", async () => {
    const before = await note();
    const r = await run(EDIT, "edit", "nexus-test-double-writer");
    expect(r.edit).toBeNull();
    expect(r.answer.insufficientReason).toMatch(/Nexus refused the proposed changes: Invalid arguments for propose_changes/);
    expect(await note()).toBe(before);
    expect(await engine.views("all")).toEqual([]);
  });

  it("takes base revisions and current values from the workspace, not from the model", async () => {
    const raw = await service.readNoteRaw(NOTE);
    const ws = readOnlyWorkspace(service, index, engine);
    const consulted = newConsulted();
    await makeAskTools(ws, new HandleRegistry(), consulted).read_note_section({ path: NOTE, headingSlug: "actions" });
    const mapped = await toProposedOperations([
      { op: "update_issue", issue: "nex-1", field: "priority", value: "urgent" },
      { op: "edit_note", note: NOTE, heading: "actions", before: "- [ ] Hein builds the calendar view", after: "- [x] Hein builds the calendar view" },
    ], ws, "op-x", consulted.reads);
    expect("operations" in mapped && mapped.operations).toEqual([
      expect.objectContaining({ kind: "record.updateField", recordKey: "NEX-1", baseRevision: 1, before: "high", after: "urgent" }),
      expect.objectContaining({ kind: "note.replaceSpan", file: NOTE, baseRevision: raw!.revision, scope: { headingSlug: "actions", sectionHash: expect.any(String), lines: { from: 0, count: expect.any(Number) } } }),
    ]);
    // A note edit needs a section this run read.
    expect(await toProposedOperations([{ op: "edit_note", note: NOTE, heading: "decisions", before: "x", after: "y" }], ws, "op-z", consulted.reads))
      .toEqual({ error: expect.stringMatching(/read the section that holds these lines/) });
    const unknown = await toProposedOperations([{ op: "link_issue", issue: "NEX-9", note: NOTE, heading: "actions" }], readOnlyWorkspace(service, index, engine), "op-y");
    expect(unknown).toEqual({ error: "Operation 1: no issue NEX-9, and no create_issue with that ref." });
  });
});
