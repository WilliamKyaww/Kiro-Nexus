// R6-6 (Astra 6.2's review of run 6): one correct field value certified a statement whose other
// assertion contradicted the record or the run's tracking result, a negated due date passed, and
// ordinary status wording was demoted. Reproduced with the production read tools and handle
// registry, the validator and the live-check evaluator, in a copy of the fictional sample. No
// provider is called: each raw answer stands in for a model's final_answer.
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
const NEX1_AS_READ = "Not confirmed: the record Nexus read says NEX-1 (Build calendar view) is in progress and due on 5 December 2026.";
const TRACKING_QUALIFIER = /^Not confirmed: Nexus checks whether an action is tracked only through its own sentences above.*NEX-1 \(Build calendar view\) is in progress and due on 5 December 2026\.$/;
const SENTENCES = ["“Will writes the judge instructions” has no matching issue.", "“Hein builds the calendar view” is tracked by NEX-1 (Build calendar view, in progress)."];
const complete = { read: 1, total: 1, complete: true };
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-evidence-r6-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `evidence-r6-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

/** The kickoff's Actions section and the issue records, read through the production tools. */
async function readKickoff() {
  const handles = new HandleRegistry();
  const tools = makeAskTools(readOnlyWorkspace(service, index, engine), handles, newConsulted());
  const actions = ((await tools.read_note_section({ path: NOTE, headingSlug: "actions" })) as { handle: string }).handle;
  const issues = (await tools.query_issues({})).issues;
  return { handles, actions, nex1: issues[0]!.handle, issues };
}
const entry = (action: string, source: string, status: "tracked" | "untracked", issues: string[] = []) => ({ action, source, status, issues, reason: "" });
const texts = (items: AnswerItem[]) => items.map((i) => i.text);

describe("R6-6: the validator checks every assertion of a statement", () => {
  const COMPOUND = "The calendar view has no matching issue. NEX-1 is due on 5 December.";

  it("does not record a statement whose correct due date sits beside a denial of the tracking result (the reviewer's case)", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const variants = [
      COMPOUND,
      "The calendar view has no matching issue, but NEX-1 is due on 5 December.",
      "NEX-1 is due on 5 December, and the calendar view has no matching issue.",
      "It has no matching issue. NEX-1 is due on 5 December.",
      "The calendar view, which has no matching issue, is due on 5 December.",
      "The calendar view is untracked; NEX-1 is due on 5 December.",
      "NEX-1 is in progress. It is not the calendar view.",
    ];
    for (const text of variants) {
      for (const sources of [[nex1], [actions, nex1]]) {
        for (const kind of ["facts", "discrepancies"] as const) {
          const r = validateAnswer({ [kind]: [{ text, sources }], tracking: right }, handles, complete);
          const where = `${kind}: ${text} (${sources.join(",")})`;
          expect(texts(r.facts), where).toEqual(SENTENCES);
          expect(r.discrepancies, where).toEqual([]);
          expect(r.unconfirmed, where).toEqual([{ text, sources, qualifier: expect.stringMatching(TRACKING_QUALIFIER) }]);
        }
      }
    }
  });

  it("does not record a negated value that the record contradicts", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const wrong = [
      "The calendar view is not due on 5 December.", // the reviewer's case
      "The calendar view isn't due on 2026-12-05.",
      "NEX-1 is no longer in progress.",
      "NEX-1 is not under way.",
    ];
    for (const text of wrong) {
      for (const tracking of [right, []]) {
        const r = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking }, handles, complete);
        expect(texts(r.facts), text).not.toContain(text);
        expect(r.unconfirmed, text).toEqual([{ text, sources: [nex1], qualifier: NEX1_AS_READ }]);
      }
    }
    // A negation that is true of the record stays a recorded fact.
    expect(texts(validateAnswer({ facts: [{ text: "NEX-1 is not done yet.", sources: [nex1] }], tracking: [] }, handles, complete).facts)).toEqual(["NEX-1 is not done yet."]);
    expect(texts(validateAnswer({ facts: [{ text: "The calendar view is not due until 5 December.", sources: [nex1] }], tracking: right }, handles, complete).facts))
      .toEqual([...SENTENCES, "The calendar view is not due until 5 December."]);
  });

  it("recognises ordinary status wording, so a correct statement is recorded and a wrong one is not", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    for (const text of [
      "The calendar view is already under way.", // the reviewer's case
      "Work on the calendar view has started.",
      "The calendar view is underway and due on 5 December.",
      "Hein's calendar view is in progress.",
    ]) {
      const r = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking: right }, handles, complete);
      expect(texts(r.facts), text).toEqual([...SENTENCES, text]);
      expect(r.unconfirmed, text).toEqual([]);
    }
    for (const text of ["The calendar view is finished.", "The calendar view is complete.", "The calendar view has not started yet.", "NEX-1 is still to do."]) {
      const r = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking: right }, handles, complete);
      expect(texts(r.facts), text).toEqual(SENTENCES);
      expect(r.unconfirmed, text).toEqual([{ text, sources: [nex1], qualifier: NEX1_AS_READ }]);
    }
  });

  it("checks each clause against the record it names", async () => {
    const project = service.listProjects()[0]!;
    await service.createIssue({ projectId: project.id, title: "Book judge travel" }); // NEX-2, to do
    const { handles, issues } = await readKickoff();
    const [nex1, nex2] = [issues.find((i) => i.key === "NEX-1")!.handle, issues.find((i) => i.key === "NEX-2")!.handle];
    const two = { read: 2, total: 2, complete: true };
    const fact = (text: string) => validateAnswer({ facts: [{ text, sources: [nex1, nex2] }], tracking: [] }, handles, two);
    expect(texts(fact("NEX-1 is in progress, but NEX-2 is still to do.").facts)).toEqual(["NEX-1 is in progress, but NEX-2 is still to do."]);
    // Each status is one of the two records' statuses, but not the one of the record it names.
    const swapped = fact("NEX-1 is to do, but NEX-2 is in progress.");
    expect(swapped.facts).toEqual([]);
    expect(swapped.unconfirmed).toEqual([expect.objectContaining({ qualifier: expect.stringMatching(/^Not confirmed: the records Nexus read say NEX-1 .*; NEX-2 \(Book judge travel\) is to do/) })]);
  });
});

describe("R6-6: the live-check evaluator judges the same statements the same way", () => {
  const options = (records: boolean) => ({ actionsHeadingExists: true, existingIssues: new Set(["NEX-1"]), ...(records ? { records: service.listIssues() } : {}) });
  const failures = (answer: unknown, records = true) => evaluateTurn({ status: "complete", answer }, 1, options(records)).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  const STRAY = /^Turn 1: the recorded facts and discrepancies say nothing else about these actions: /;

  it("fails each statement the validator now refuses when it is shown as recorded, with or without the records", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    for (const text of [
      "The calendar view has no matching issue. NEX-1 is due on 5 December.",
      "It has no matching issue. NEX-1 is due on 5 December.",
      "The calendar view is not due on 5 December.",
    ]) {
      // As the run-6 validator rendered it: correct entries, plus the statement as a fact.
      const shown = validateAnswer({ tracking: right }, handles, complete);
      shown.facts.push({ text, sources: [nex1] });
      for (const records of [true, false]) {
        const f = failures(shown, records);
        expect(f, `${text} (records: ${records})`).toHaveLength(1);
        expect(f[0]).toMatch(STRAY);
        expect(f[0]).toContain(text);
      }
      // The validator now shows it under "Not confirmed by the evidence", which the check accepts.
      const validated = validateAnswer({ facts: [{ text, sources: [nex1] }], tracking: right }, handles, complete);
      expect(texts(validated.unconfirmed), text).toEqual([text]);
      expect(failures(validated), text).toEqual([]);
      expect(failures(validated, false), text).toEqual([]);
    }
  });

  it("passes ordinary status wording that the record agrees with, and fails it when the record does not", async () => {
    const { handles, actions, nex1 } = await readKickoff();
    const right = [entry(JUDGE, actions, "untracked"), entry(CAL, actions, "tracked", [nex1])];
    const fact = "The calendar view is already under way.";
    const answer = validateAnswer({ facts: [{ text: fact, sources: [nex1] }], tracking: right }, handles, complete);
    expect(texts(answer.facts)).toContain(fact);
    expect(failures(answer)).toEqual([]);
    expect(failures(answer, false)).toEqual([]);
    const shown = validateAnswer({ tracking: right }, handles, complete);
    shown.facts.push({ text: "The calendar view is finished.", sources: [nex1] });
    expect(failures(shown)).toEqual([expect.stringMatching(STRAY)]);
  });
});
