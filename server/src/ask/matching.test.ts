// Requirement 8: matching meeting actions to issues, against the deterministic test double
// (a fixture, not AI). Codex saw these on live Groq and NVIDIA (e61a3d4) and on 4093fa1:
// "Hein calendar view" found no issue, so NEX-1 was missed; and "The judge instructions do
// not appear on the board" was a recorded fact after 0 of 1 issues had been read.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { validateAnswer } from "./answer";
import { runAsk } from "./coordinator";
import { HandleRegistry } from "./handles";
import { makeAskTools, newConsulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const KEY = "nexus-fake-ask-key-3b9e";
const QUESTION = "Which action from the kickoff still has no issue?";
const NOTE = "meetings/2026-11-24 kickoff.md";
let double: ProviderDouble;
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;

const profile = (model: string) => ({
  id: "prf_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", name: "Test double", baseUrl: double.baseUrl, model, createdAt: "",
  capabilities: { toolCalling: "yes" as const, structuredOutput: "yes" as const, testedAt: null, detail: null, fixture: true },
});
const ask = (model: string, limits?: { issueCap?: number }) =>
  runAsk({ workspace: readOnlyWorkspace(service, index, engine), question: QUESTION, profile: profile(model), key: KEY, receivingHost: "127.0.0.1", limits });
const texts = (items: Array<{ text: string }>) => items.map((i) => i.text).join("\n");
const sentToolCalls = (from: number) => double.requests.slice(from).flatMap((r) => (r.body.messages as Array<{ tool_calls?: Array<{ function: { name: string; arguments: string } }> }>)
  .flatMap((m) => m.tool_calls ?? [])).map((c) => `${c.function.name} ${c.function.arguments}`);

beforeAll(async () => { double = await startProviderDouble(); });
afterAll(async () => { await double.close(); });
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-matching-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `match-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("an empty narrow lookup recovers through the project's records", () => {
  it("lists the records when the owner's name is not in any issue title", async () => {
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), new HandleRegistry(), newConsulted());
    const narrow = await tools.query_issues({ text: "Hein calendar view" });
    expect(narrow).toMatchObject({ textMatched: false, total: 1, issues: [expect.objectContaining({ key: "NEX-1" })] });
    expect(narrow.note).toMatch(/No issue matched the words “Hein calendar view”/);
    expect(await tools.query_issues({ text: "calendar view" })).toMatchObject({ textMatched: true, issues: [expect.objectContaining({ key: "NEX-1" })] });
  });

  it("answers correctly when the model looks each action up with the owner's name", async () => {
    const from = double.requests.length;
    const r = await ask("nexus-test-double-narrow");
    expect(sentToolCalls(from)).toContain('query_issues {"text":"Hein builds the calendar view"}');
    expect(texts(r.answer.facts)).toMatch(/“Hein builds the calendar view” is tracked by NEX-1/);
    expect(texts(r.answer.facts)).toMatch(/“Will writes the judge instructions” has no matching issue/);
    expect(r.answer.tracking).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "Hein builds the calendar view", status: "tracked", confirmed: true }),
      expect.objectContaining({ action: "Will writes the judge instructions", status: "untracked", confirmed: true }),
    ]));
  });
});

describe("a shared heading is not evidence of which action an issue tracks", () => {
  it("does not confirm that NEX-1 tracks the judge instructions because both sit under Actions", async () => {
    const r = await ask("nexus-test-double-heading");
    expect(texts(r.answer.facts)).toMatch(/“Hein builds the calendar view” is tracked by NEX-1/);
    expect(texts(r.answer.facts)).not.toMatch(/judge/);
    expect(r.answer.unconfirmed).toEqual([expect.objectContaining({
      text: expect.stringMatching(/“Will writes the judge instructions” is tracked by NEX-1/),
      qualifier: "Not confirmed: NEX-1 shares no words with this action, and a link to the same heading does not show which action an issue tracks.",
    })]);
  });
});

describe("a claim about the board needs the board's records", () => {
  it("reads the remaining records before accepting an answer that rests on unread issues", async () => {
    const from = double.requests.length;
    const r = await ask("nexus-test-double-noissues");
    expect(sentToolCalls(from).filter((c) => c.startsWith("query_issues"))).toEqual([]); // the model never looked
    expect(r.consulted.completedByNexus).toBe(1);
    expect(r.scopeNote).toMatch(/Nexus read the other 1 issue record before accepting the answer/);
    expect(r.scopeNote).toMatch(/\(1 of 1 read\)/);
    expect(texts(r.answer.facts)).toMatch(/“Hein builds the calendar view” is tracked by NEX-1/);
    expect(texts(r.answer.facts)).not.toMatch(/do not appear on the board/);
    expect(r.answer.unconfirmed).toEqual([]);
  });

  it("does not record the claim as a fact when Nexus cannot read the records either", async () => {
    const r = await ask("nexus-test-double-noissues", { issueCap: 0 });
    expect(r.consulted.completedByNexus).toBeUndefined();
    expect(texts(r.answer.facts)).not.toMatch(/do not appear on the board/);
    expect(r.answer.unconfirmed).toEqual([{
      text: "The judge instructions do not appear on the board.", sources: [expect.stringMatching(/^S\d+$/)],
      qualifier: "Not confirmed: Nexus did not read the issue records in this run, so a matching issue may exist.",
    }]);
  });
});

describe("the evidence rules, independent of wording", () => {
  async function readKickoff() {
    const handles = new HandleRegistry();
    const consulted = newConsulted();
    consulted.issueTotal = 1;
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), handles, consulted);
    const actions = await tools.read_note_section({ path: NOTE, headingSlug: "actions" });
    const decisions = await tools.read_note_section({ path: NOTE, headingSlug: "decisions" });
    return { handles, consulted, tools, actions: (actions as { handle: string }).handle, decisions: (decisions as { handle: string }).handle };
  }
  const incomplete = { read: 0, total: 1, complete: false };
  const complete = { read: 1, total: 1, complete: true };

  it("checks each tracking entry against the section and the records the run read", async () => {
    const { handles, tools, actions } = await readKickoff();
    const nex1 = (await tools.query_issues({})).issues[0]!.handle;
    const answer = (tracking: unknown[]) => validateAnswer({ facts: [], discrepancies: [], suggestions: [], tracking, insufficientEvidence: false }, handles, complete);
    expect(answer([{ action: "Hein builds the calendar view", source: actions, status: "tracked", issues: [nex1], reason: "" }]).facts[0]!.text)
      .toBe("“Hein builds the calendar view” is tracked by NEX-1 (Build calendar view, in progress).");
    expect(answer([{ action: "Hein builds the calendar view", source: actions, status: "tracked", issues: [], reason: "" }]).unconfirmed[0]!.qualifier)
      .toBe("Not confirmed: no issue record from this run was cited.");
    expect(answer([{ action: "Priya books the catering", source: actions, status: "untracked", issues: [], reason: "" }]).unconfirmed[0]!.qualifier)
      .toBe("Not confirmed: Nexus could not find this action in the cited section.");
    expect(answer([{ action: "Will writes the judge instructions", source: "S99", status: "untracked", issues: [], reason: "" }]).unconfirmed[0]!.qualifier)
      .toBe("Not confirmed: the action does not cite a note section that Nexus read in this run.");
    const untracked = [{ action: "Will writes the judge instructions", source: actions, status: "untracked", issues: [], reason: "" }];
    expect(answer(untracked).facts[0]!.text).toBe("“Will writes the judge instructions” has no matching issue.");
    expect(validateAnswer({ tracking: untracked }, handles, { read: 0, total: 1, complete: false }).unconfirmed[0]!.qualifier).toMatch(/did not read the issue records/);
  });

  it("decides a free-text claim by its evidence, not its wording", async () => {
    const { handles, actions, decisions } = await readKickoff();
    const fact = (text: string, sources: string[], coverage: typeof complete) =>
      validateAnswer({ facts: [{ text, sources }], tracking: [] }, handles, coverage);
    // The same sentence, worded in a way no phrase list would expect:
    const claim = "Nobody has put the judging guide onto the board yet.";
    expect(fact(claim, [actions], incomplete).unconfirmed.map((u) => u.text)).toEqual([claim]);
    expect(fact(claim, [actions], complete).facts.map((f) => f.text)).toEqual([claim]); // every record was read
    // A statement about the decisions, which list no actions, does not depend on the issues.
    expect(fact("Every agent edit is reviewed one change at a time.", [decisions], incomplete).facts).toHaveLength(1);
  });
});
