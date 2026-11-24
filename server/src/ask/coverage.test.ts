// Evidence coverage for absence claims, and accepted versus proposed note text, in both
// Ask modes, against the deterministic test double (a fixture, not AI).
// Reproduced on e61a3d4: with 51 issues and "Write the judge instructions" at NEX-51, Ask
// read 50 and presented "has no matching issue" as a recorded fact.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { demoOperations } from "../review/index";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { runAsk } from "./coordinator";
import { HandleRegistry } from "./handles";
import { makeAskTools, type Consulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const KEY = "nexus-fake-ask-key-3b9e";
const QUESTION = "Which action from the kickoff still has no issue?";
let double: ProviderDouble;
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;

const profile = (model: string, tools: boolean) => ({
  id: "prf_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", name: "Test double", baseUrl: double.baseUrl, model, createdAt: "",
  capabilities: { toolCalling: tools ? "yes" as const : "no" as const, structuredOutput: "yes" as const, testedAt: null, detail: null, fixture: true },
});
const MODES = [
  { mode: "tools", model: "nexus-test-double", tools: true },
  { mode: "retrieval-first", model: "nexus-test-double-structured", tools: false },
] as const;
const ask = (m: (typeof MODES)[number], model: string = m.model, limits?: { retrievalIssueCap?: number }) =>
  runAsk({ workspace: readOnlyWorkspace(service, index, engine), question: QUESTION, profile: profile(model, m.tools), key: KEY, receivingHost: "127.0.0.1", limits });
const texts = (items: Array<{ text: string }>) => items.map((i) => i.text).join("\n");

beforeAll(async () => { double = await startProviderDouble(); });
afterAll(async () => { await double.close(); });
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-coverage-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `cov-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

/** NEX-1 is the sample's calendar issue; NEX-2 to NEX-50 are fillers; NEX-51 is `last`. */
async function fiftyOneIssues(last: string) {
  const project = service.listProjects()[0]!;
  for (let i = 2; i <= 50; i++) await service.createIssue({ projectId: project.id, title: `Fictional filler task ${String(i).padStart(2, "0")}` });
  await service.createIssue({ projectId: project.id, title: last });
  expect(service.listIssues().at(-1)).toMatchObject({ key: "NEX-51", title: last });
}

describe.each(MODES)("evidence coverage in $mode mode", (m) => {
  it("finds a matching issue beyond the first 50", async () => {
    await fiftyOneIssues("Write the judge instructions");
    const r = await ask(m);
    expect(texts(r.answer.facts)).toMatch(/Will writes the judge instructions.*tracked by NEX-51/);
    expect(texts(r.answer.facts)).not.toMatch(/has no matching issue/);
    expect(r.answer.unconfirmed).toEqual([]);
    expect(r.scopeNote).toMatch(/51 of 51/);
  });

  it("states a genuinely missing task as a fact only after every record was checked", async () => {
    await fiftyOneIssues("Fictional filler task 51");
    const r = await ask(m);
    expect(texts(r.answer.facts)).toMatch(/Will writes the judge instructions.*has no matching issue/);
    expect(r.answer.unconfirmed).toEqual([]);
    expect(r.scopeNote).toMatch(/51 of 51/);
  });

  it("qualifies an absence claim where the user reads it when coverage stays incomplete", async () => {
    await fiftyOneIssues("Write the judge instructions");
    // A model that does not page (tool mode), or a retrieval cap below the total.
    const r = m.tools ? await ask(m, "nexus-test-double-lazy") : await ask(m, m.model, { retrievalIssueCap: 50 });
    expect(texts(r.answer.facts)).not.toMatch(/has no matching issue/);
    expect(r.answer.unconfirmed).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/Will writes the judge instructions.*has no matching issue/), qualifier: "Not confirmed: Nexus read 50 of 51 issues in this run, so a matching issue may exist." }),
    ]);
    expect(r.scopeNote).toMatch(/Scope limited: .*50 of 51 issues/);
  });

  it("keeps the accepted checklist text and reports the pending tick as proposed", async () => {
    await engine.propose({ kind: "fixed-demo", label: "Demo operations (fixed, not AI)" }, await demoOperations(service), "demo");
    const r = await ask(m);
    // Accepted: unticked and in progress, so there is no discrepancy to report.
    expect(texts(r.answer.facts)).toMatch(/Hein builds the calendar view.*tracked by NEX-1/);
    expect(r.answer.discrepancies).toEqual([]);
    const sent = JSON.stringify(double.requests.at(-1)!.body.messages);
    expect(sent).toContain("- [ ] Hein builds the calendar view");
    expect(sent).toMatch(/proposed[^}]*- \[x\] Hein builds the calendar view/);
  });
});

describe("search snippets agree with section reads", () => {
  it("shows accepted text in snippets, with the pending edit reported as proposed", async () => {
    await engine.propose({ kind: "fixed-demo", label: "Demo operations (fixed, not AI)" }, await demoOperations(service), "demo");
    const consulted: Consulted = { searches: [], sectionsRead: [], issueQueries: [], issueIdsSeen: new Set(), issueTotal: 0 };
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), new HandleRegistry(), consulted);
    const found = await tools.search_notes({ query: "calendar view" });
    const hit = found.results.find((h) => h.headingSlug === "actions")!;
    expect(hit.snippet).toContain("[ ] Hein builds the calendar view");
    expect(hit.snippet).not.toContain("[x] Hein builds the calendar view");
    expect(hit.pendingReview).toEqual([{ proposed: "- [x] Hein builds the calendar view", replaces: "- [ ] Hein builds the calendar view" }]);
    const section = await tools.read_note_section({ path: hit.path, headingSlug: "actions" });
    expect(section).toMatchObject({ text: expect.stringContaining("- [ ] Hein builds the calendar view"), pendingReview: hit.pendingReview });
  });

  it("pages through issues and reports what remains", async () => {
    await fiftyOneIssues("Write the judge instructions");
    const consulted: Consulted = { searches: [], sectionsRead: [], issueQueries: [], issueIdsSeen: new Set(), issueTotal: 0 };
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), new HandleRegistry(), consulted);
    const first = await tools.query_issues({});
    expect(first).toMatchObject({ total: 51, offset: 0, truncated: true, nextOffset: 50 });
    expect(first.note).toMatch(/offset 50/);
    const rest = await tools.query_issues({ offset: 50 });
    expect(rest).toMatchObject({ offset: 50, truncated: false, nextOffset: null, issues: [expect.objectContaining({ key: "NEX-51" })] });
    expect(consulted.issueIdsSeen.size).toBe(51);
    expect((await tools.query_issues({ text: "judge instructions" })).issues.map((i) => i.key)).toEqual(["NEX-51"]);
  });
});
