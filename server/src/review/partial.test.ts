// Phase 1 item 1: a run whose issue write fails after the note write succeeded.
// Reproduced on 2310608: the UI said "Applied 2", the date never changed, and a
// repeated demo after restart said "already applied". Every check reads real files.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, ReviewRun } from "@nexus/schema";
import { setFaultInjector } from "../faults";
import { sha256 } from "../workspace/atomic";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { DEMO_NOTE, demoOperations } from "./index";
import { ReviewEngine } from "./engine";

let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let n = 0;
const source = { kind: "fixed-demo" as const, label: "Demo operations (fixed, not AI)" };
const notePath = () => join(ws, ...DEMO_NOTE.split("/"));
const issuesPath = () => join(ws, ".nexus", "issues.json");
const nex1 = async () => IssuesFile.parse(JSON.parse(await readFile(issuesPath(), "utf8"))).issues.find((i) => i.key === "NEX-1")!;
const journal = async () => {
  const [f] = (await readdir(join(ws, ".nexus", "reviews"))).filter((x) => x.endsWith(".json"));
  return ReviewRun.parse(JSON.parse(await readFile(join(ws, ".nexus", "reviews", f!), "utf8")));
};

async function open() {
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `p-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
}
async function restart() { setFaultInjector(null); await service.close(); await open(); }
const failWrite = (path: string) => setFaultInjector((p) => { if (p === `review:write:${path}`) throw new Error("Simulated: the file is locked by another program"); });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-partial-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  await open();
});
afterEach(async () => { setFaultInjector(null); await service.close(); await rm(base, { recursive: true, force: true }); });

async function partialRun() {
  failWrite(".nexus/issues.json");
  const outcome = await engine.propose(source, await demoOperations(service), "demo");
  setFaultInjector(null);
  return outcome;
}

describe("partial runs", () => {
  it("reports each file's real outcome and keeps the successful change reviewable", async () => {
    const issuesBefore = await readFile(issuesPath());
    const outcome = await partialRun();
    expect(outcome.phase).toBe("partial");
    expect(outcome.files).toEqual([
      { path: DEMO_NOTE, state: "written", error: null },
      { path: ".nexus/issues.json", state: "failed", error: expect.stringContaining("locked") },
    ]);
    expect(outcome.changes.map((c) => [c.state, c.fileState])).toEqual([["pending", "written"], ["prepared", "failed"]]);
    expect(await readFile(notePath(), "utf8")).toContain("- [x] Hein builds the calendar view\n");
    expect(await readFile(issuesPath())).toEqual(issuesBefore);
    const run = await journal();
    expect(run.phase).toBe("partial");
    expect(run.files.map((f) => f.state)).toEqual(["written", "failed"]);
  });

  it("stays honest after a restart: nothing is written silently, and a repeated demo reports the failure", async () => {
    await partialRun();
    await restart();
    expect((await nex1()).due).toEqual({ date: "2026-12-05" });
    const incomplete = await engine.incompleteRuns();
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]!.files.map((f) => f.state)).toEqual(["written", "failed"]);
    const again = await engine.propose(source, await demoOperations(service), "demo");
    expect(again.repeated).toBe(true);
    expect(again.phase).toBe("partial");
    expect(again.files[1]).toMatchObject({ path: ".nexus/issues.json", state: "failed" });
  });

  it("Retry writes only the outstanding file, after a restart, and repeating it is a no-op", async () => {
    await partialRun();
    await restart();
    const noteBytes = await readFile(notePath());
    const outcome = await engine.retry((await engine.incompleteRuns())[0]!.runId!);
    expect(outcome.phase).toBe("applied");
    expect(outcome.files.map((f) => f.state)).toEqual(["written", "written"]);
    expect(outcome.changes.map((c) => c.state)).toEqual(["pending", "pending"]);
    expect(await readFile(notePath())).toEqual(noteBytes); // the note was not rewritten
    expect(await nex1()).toMatchObject({ due: { date: "2026-12-03" }, revision: 2 });
    const run = await journal();
    expect(run.files[1]!.afterHash).toBe(sha256(await readFile(issuesPath())));
    const repeat = await engine.retry(run.runId);
    expect(repeat.phase).toBe("applied");
    expect((await nex1()).revision).toBe(2);
    // The retried change is a normal reviewable change: reject restores the date.
    await engine.reject(outcome.changes[1]!.changeId);
    expect((await nex1()).due).toEqual({ date: "2026-12-05" });
  });

  it("Retry keeps an unrelated manual edit made in between", async () => {
    const { runId } = await partialRun();
    await service.updateIssue("NEX-1", 1, { title: "Build the month calendar" });
    await engine.retry(runId!);
    expect(await nex1()).toMatchObject({ title: "Build the month calendar", due: { date: "2026-12-03" }, revision: 3 });
  });

  it("Retry refuses to overwrite a manual edit to the same field and reports a conflict", async () => {
    const { runId } = await partialRun();
    await service.updateIssue("NEX-1", 1, { due: { date: "2026-12-04" } });
    const outcome = await engine.retry(runId!);
    expect(outcome.files[1]).toMatchObject({ state: "conflicted" });
    expect(outcome.changes[1]).toMatchObject({ state: "conflicted", conflictReason: "changed-before-apply" });
    expect((await nex1()).due).toEqual({ date: "2026-12-04" });
    expect(outcome.phase).toBe("applied"); // nothing outstanding; the conflict is closed with Keep current
  });

  it("Discard preserves the file and the successful sibling change, and is idempotent", async () => {
    const { runId, changes } = await partialRun();
    const issuesBefore = await readFile(issuesPath());
    const outcome = await engine.discard(runId!);
    expect(outcome.files[1]).toMatchObject({ state: "discarded" });
    expect(outcome.changes.map((c) => c.state)).toEqual(["pending", "rejected"]);
    expect(await readFile(issuesPath())).toEqual(issuesBefore);
    expect(await readFile(notePath(), "utf8")).toContain("- [x] Hein builds the calendar view\n");
    expect((await engine.discard(runId!)).changes.map((c) => c.state)).toEqual(["pending", "rejected"]);
    expect((await engine.retry(runId!)).files[1]!.state).toBe("discarded");
    expect(await engine.incompleteRuns()).toEqual([]);
    await engine.accept(changes[0]!.changeId);
    await restart();
    expect((await engine.views("all")).map((v) => v.state)).toEqual(["accepted", "rejected"]);
    expect(await readFile(issuesPath())).toEqual(issuesBefore);
  });

  it("When the first file fails, later files are not attempted, and Retry writes both", async () => {
    failWrite(DEMO_NOTE);
    const outcome = await engine.propose(source, await demoOperations(service), "demo");
    setFaultInjector(null);
    expect(outcome.files.map((f) => f.state)).toEqual(["failed", "failed"]);
    expect(outcome.files[1]!.error).toContain("Not attempted");
    expect(await readFile(notePath(), "utf8")).toContain("- [ ] Hein builds the calendar view\n");
    const retried = await engine.retry(outcome.runId!);
    expect(retried.files.map((f) => f.state)).toEqual(["written", "written"]);
    expect((await nex1()).due).toEqual({ date: "2026-12-03" });
  });
});
