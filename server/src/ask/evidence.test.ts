// R5-3 (Astra 6.2's review of run 5): what an answer shows as recorded must agree with the
// issue records the run read, and the live-check evaluator must judge what is shown. Reproduced
// with the production read tools and handle registry, the validator and the evaluator, in a copy
// of the fictional sample. No provider is called: each raw answer stands in for a model's
// final_answer.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateTurn } from "../../../scripts/live-ask-check.mjs";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { validateAnswer, type AnswerItem } from "./answer";
import { HandleRegistry } from "./handles";
import { makeAskTools, newConsulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const NOTE = "meetings/2026-11-24 kickoff.md";
const JUDGE = "Will writes the judge instructions";
const CAL = "Hein builds the calendar view";
const DENIAL = "The calendar view has no matching issue.";
const NEX1_AS_READ = "Not confirmed: the record Nexus read says NEX-1 (Build calendar view) is in progress and due on 5 December 2026.";
const complete = { read: 1, total: 1, complete: true };
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-evidence-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `evidence-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

/** The kickoff's Actions section and NEX-1, read through the production tools. */
async function readKickoff() {
  const handles = new HandleRegistry();
  const tools = makeAskTools(readOnlyWorkspace(service, index, engine), handles, newConsulted());
  const actions = ((await tools.read_note_section({ path: NOTE, headingSlug: "actions" })) as { handle: string }).handle;
  const nex1 = (await tools.query_issues({})).issues[0]!.handle;
  return { handles, actions, nex1 };
}
const entry = (action: string, source: string, status: "tracked" | "untracked", issues: string[] = []) => ({ action, source, status, issues, reason: "" });
const texts = (items: AnswerItem[]) => items.map((i) => i.text);
const SENTENCES = ["“Will writes the judge instructions” has no matching issue.", "“Hein builds the calendar view” is tracked by NEX-1 (Build calendar view, in progress)."];

describe("the validator checks statements against the records the run read (R5-3)", () => {
  it("does not record a discrepancy that denies the issue Nexus confirmed tracks the action", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    for (const sources of [[nex1], [actions, nex1]]) {
      const r = validateAnswer({ discrepancies: [{ text: DENIAL, sources }], tracking: right }, handles, complete);
      expect(texts(r.discrepancies), sources.join(",")).toEqual([]);
      expect(texts(r.facts)).toEqual(SENTENCES);
      expect(r.unconfirmed).toEqual([expect.objectContaining({ text: DENIAL, qualifier: expect.stringMatching(/^Not confirmed: /) })]);
    }
    // "Not done" is true of NEX-1 but does not pin down a value, so it does not carry the denial.
    const padded = "The calendar view has no matching issue, and it is not done.";
    const r = validateAnswer({ discrepancies: [{ text: padded, sources: [actions, nex1] }], tracking: right }, handles, complete);
    expect(r.discrepancies).toEqual([]);
    expect(texts(r.unconfirmed)).toEqual([padded]);
  });

  it.each([
    "The calendar view is due on 5 December.",
    "The calendar view is due on 5 Dec 2026.",
    "The calendar view is due on 2026-12-05.",
    "The calendar view is in progress and due on December 5th.",
  ])("keeps a correct issue fact beside the tracking entries: %s", async (text) => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const r = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking: right }, handles, complete);
    expect(texts(r.facts)).toEqual([...SENTENCES, text]);
    expect(r.unconfirmed).toEqual([]);
  });

  it("does not record an issue fact that contradicts the record, with or without tracking entries", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const cases: Array<[string, unknown[]]> = [
      ["The calendar view is due on 3 December.", right],
      ["NEX-1 is due on 3 December 2026.", []],
      ["NEX-1 is done.", []],
      ["NEX-1 is still to do.", []],
    ];
    for (const [text, tracking] of cases) {
      const r = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking }, handles, complete);
      expect(texts(r.facts), text).not.toContain(text);
      expect(r.unconfirmed, text).toEqual([{ text, sources: [nex1], qualifier: NEX1_AS_READ }]);
    }
    // The same record, stated correctly, is a recorded fact.
    expect(texts(validateAnswer({ facts: [{ text: "NEX-1 is not done yet.", sources: [nex1] }], tracking: [] }, handles, complete).facts)).toEqual(["NEX-1 is not done yet."]);
  });

  it("keeps a discrepancy that states the record's value against the note's, and checks the note's side too", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const fair = "The note marks “Hein builds the calendar view” as not done, but NEX-1 is in progress.";
    expect(texts(validateAnswer({ discrepancies: [{ text: fair, sources: [actions, nex1] }], tracking: right }, handles, complete).discrepancies)).toEqual([fair]);
    // The note's checkbox is not ticked, so this misstates the note.
    const wrong = "The note marks “Hein builds the calendar view” as done, but NEX-1 is in progress.";
    const r = validateAnswer({ discrepancies: [{ text: wrong, sources: [actions, nex1] }], tracking: right }, handles, complete);
    expect(r.discrepancies).toEqual([]);
    expect(r.unconfirmed).toEqual([expect.objectContaining({ text: wrong, qualifier: expect.stringMatching(/^Not confirmed: /) })]);
  });

  it("confirms an entry worded as the issue's title, and renders Nexus's sentence for it", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const r = validateAnswer({ tracking: [entry(JUDGE, actions, "untracked"), entry("Build calendar view", actions, "tracked", [nex1])] }, handles, complete);
    expect(texts(r.facts)).toEqual([SENTENCES[0], "“Build calendar view” is tracked by NEX-1 (Build calendar view, in progress)."]);
  });
});

describe("the live-check evaluator compares the structured claims with what is shown (R5-3)", () => {
  const options = (records: boolean) => {
    // `records` is the issue list the CLI reads from the API; the browser test passes keys only.
    const opts = { actionsHeadingExists: true, existingIssues: new Set(["NEX-1"]), ...(records ? { records: service.listIssues() } : {}) };
    return opts;
  };
  const failures = (answer: unknown, records = true) => evaluateTurn({ status: "complete", answer }, 1, options(records)).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  const STRAY = /^Turn 1: the recorded facts and discrepancies say nothing else about these actions: /;

  it("passes a correct answer whose tracked action is worded as the issue's title", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const answer = validateAnswer({ tracking: [entry(JUDGE, actions, "untracked"), entry("Build calendar view", actions, "tracked", [nex1])] }, handles, complete);
    expect(failures(answer)).toEqual([]);
    expect(failures(answer, false)).toEqual([]);
  });

  it("passes a correct due-date fact shown beside the tracking result", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const fact = "The calendar view is due on 5 December.";
    const answer = validateAnswer({ facts: [{ text: fact, sources: [nex1] }], tracking: [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])] }, handles, complete);
    expect(texts(answer.facts)).toContain(fact);
    expect(failures(answer)).toEqual([]);
  });

  it("fails an answer that shows the contradictory discrepancy, and passes it once it is under Not confirmed", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    // As the run-5 validator rendered it: correct entries, plus the denial as a discrepancy.
    const shown = validateAnswer({ tracking: right }, handles, complete);
    shown.discrepancies.push({ text: DENIAL, sources: [nex1] });
    for (const records of [true, false]) {
      const f = failures(shown, records);
      expect(f, `records: ${records}`).toHaveLength(1);
      expect(f[0]).toMatch(STRAY);
      expect(f[0]).toContain(DENIAL);
    }
    // The validator now shows it under "Not confirmed by the evidence", which the check accepts.
    expect(failures(validateAnswer({ discrepancies: [{ text: DENIAL, sources: [nex1] }], tracking: right }, handles, complete))).toEqual([]);
  });

  it("fails a shown fact whose due date contradicts the record, and a confirmed entry that is not shown", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const shown = validateAnswer({ tracking: right }, handles, complete);
    shown.facts.push({ text: "The calendar view is due on 3 December.", sources: [nex1] });
    expect(failures(shown)).toEqual([expect.stringMatching(STRAY)]);
    // The structured entry says "tracked by NEX-1", but nothing shows it as a recorded fact.
    const hidden = validateAnswer({ tracking: right }, handles, complete);
    hidden.facts = hidden.facts.filter((f) => !f.text.includes("NEX-1"));
    expect(failures(hidden)).toEqual([expect.stringMatching(/^Turn 1: Hein's calendar work is tracked by NEX-1, from the Actions heading, confirmed by the evidence: /)]);
  });

  it("accepts the fair discrepancy the test double gives, with or without the records", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const fair = "The note marks “Hein builds the calendar view” as not done, but NEX-1 is in progress.";
    const answer = validateAnswer({ discrepancies: [{ text: fair, sources: [actions, nex1] }], tracking: [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])] }, handles, complete);
    expect(texts(answer.discrepancies)).toEqual([fair]);
    expect(failures(answer)).toEqual([]);
    expect(failures(answer, false)).toEqual([]);
  });
});
