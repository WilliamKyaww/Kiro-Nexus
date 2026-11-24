// The live-check CLI (scripts/live-ask-check.mjs), run as a real child process against the
// deterministic test double (a fixture, not AI). It proves the two-turn journey: the missing
// action, then NEX-2 created through the issue API and recognised in the same conversation.
// Reproduced on e61a3d4: the bodyless provider test got 400 and the command still exited 0.
// Reproduced by Codex on the evaluator: "NEX-1 does not track the calendar work" scored 7/7,
// and a correct answer failed when its first NEX-1 citation described the status.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { EXIT, evaluateTurn, workspaceHashes } from "../../../scripts/live-ask-check.mjs";

const KEY = "nexus-fake-live-key-0c4d";
let double: ProviderDouble;
let out: string;
beforeAll(async () => { double = await startProviderDouble(); out = await mkdtemp(join(tmpdir(), "nexus-live-cli-")); });
afterAll(async () => { await double.close(); await rm(out, { recursive: true, force: true }); });

interface Run { code: number | null; stdout: string; stderr: string; report: Record<string, any> }

async function runCli(env: Record<string, string | undefined>): Promise<Run> {
  const dir = await mkdtemp(join(out, "run-"));
  const child = spawn(process.execPath, ["scripts/live-ask-check.mjs"], {
    env: { ...process.env, NEXUS_LIVE_BASE_URL: double.baseUrl, NEXUS_LIVE_OUT_DIR: dir, NEXUS_LIVE_KEY: KEY, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const code = await new Promise<number | null>((r) => child.once("exit", r));
  const files = await readdir(dir);
  const report = files.length ? JSON.parse(await readFile(join(dir, files[0]!), "utf8")) : {};
  return { code, stdout, stderr, report };
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("live-check CLI against the local fixture", () => {
  it("runs both turns, passes every check, and still refuses to call a fixture a live pass", async () => {
    const before = double.requests.length;
    const r = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double" });
    expect(r.code).toBe(EXIT.fixture);
    expect(double.requests.length - before).toBeGreaterThanOrEqual(6); // two probes and two Ask runs
    expect(r.report).toMatchObject({ verdict: "fixture, not a live pass", exitCode: EXIT.fixture, liveProvider: false, capabilities: { toolCalling: "yes", structuredOutput: "yes", fixture: true } });
    expect(r.report.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
    expect(r.report.checks.map((c: { name: string }) => c.name)).toEqual([
      "Turn 1: answer completed",
      "Turn 1: evidence sufficient",
      "Turn 1: Will's judge instructions are untracked, from the Actions heading, confirmed by the evidence",
      "Turn 1: Hein's calendar work is tracked by NEX-1, from the Actions heading, confirmed by the evidence",
      "Turn 1: no confirmed entry contradicts these",
      "Turn 1: the recorded facts and discrepancies say nothing else about these actions",
      "Turn 1: the Actions heading citation opens",
      "Turn 1: the NEX-1 citation opens",
      "Turn 1: Ask left the notes and issues unchanged",
      "Turn 2: answer completed",
      "Turn 2: evidence sufficient",
      "Turn 2: Will's judge instructions are tracked by NEX-2, from the Actions heading, confirmed by the evidence",
      "Turn 2: Hein's calendar work is tracked by NEX-1, from the Actions heading, confirmed by the evidence",
      "Turn 2: no confirmed entry contradicts these",
      "Turn 2: the recorded facts and discrepancies say nothing else about these actions",
      "Turn 2: the Actions heading citation opens",
      "Turn 2: the NEX-1 citation opens",
      "Turn 2: the NEX-2 citation opens",
      "Turn 2: Ask left the notes and issues unchanged",
    ]);
    expect(r.report.turns.map((t: { changedByAsk: string[] }) => t.changedByAsk)).toEqual([[], []]);
    expect(r.report.turns[1].meta.contextTurns).toBe(1); // the second turn ran in the same conversation
    expect(r.stdout).toContain('Created NEX-2 "Write the judge instructions" through the issue API.');
    expect(r.stdout).toContain("never counts as a live pass");
    expect(alive(r.report.servicePid)).toBe(false);
    expect(r.stdout + JSON.stringify(r.report)).not.toContain(KEY);
  });

  it.each([
    ["a rejected key", { NEXUS_LIVE_KEY: "invalid-key", NEXUS_LIVE_MODEL: "nexus-test-double" }, EXIT.auth, /PROVIDER_AUTH/],
    ["a model without tools or structured output", { NEXUS_LIVE_MODEL: "nexus-test-double-none" }, EXIT.unsupported, /neither tool calling nor structured output/],
    ["an answer that takes too long", { NEXUS_LIVE_MODEL: "nexus-test-double-slow", NEXUS_LIVE_ANSWER_TIMEOUT_MS: "1500" }, EXIT.timeout, /No answer within 2 s/],
    ["an insufficient-evidence answer", { NEXUS_LIVE_MODEL: "nexus-test-double-unsure" }, EXIT.checkFailed, /checks? failed in turn 1/],
    ["an answer without the NEX-1 citation", { NEXUS_LIVE_MODEL: "nexus-test-double-nocite" }, EXIT.checkFailed, /checks? failed in turn 1/],
    ["a model that attributes both actions to NEX-1 by its heading link", { NEXUS_LIVE_MODEL: "nexus-test-double-heading" }, EXIT.checkFailed, /checks? failed in turn 1/],
    ["a missing key and no terminal to ask in", { NEXUS_LIVE_KEY: "" }, EXIT.setup, /No key was given/],
  ])("fails with a distinct status for %s", async (_name, env, exit, message) => {
    const r = await runCli(env);
    expect(r.code).toBe(exit);
    expect(r.stdout + r.stderr).toMatch(message);
    if (r.report.servicePid) expect(alive(r.report.servicePid)).toBe(false);
    if (exit !== EXIT.setup) expect(r.report.exitCode).toBe(exit);
  });

  it("passes the journey for a model that looks actions up by the owner's name", async () => {
    // The live models' search pattern; Nexus now lists the project's records after an empty lookup.
    const r = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double-narrow" });
    expect(r.code).toBe(EXIT.fixture);
    expect(r.report.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
  });

  it("records which check failed", async () => {
    const unsure = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double-unsure" });
    expect(unsure.report.checks.find((c: { name: string }) => c.name === "Turn 1: evidence sufficient")).toMatchObject({ ok: false });
    const heading = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double-heading" });
    expect(heading.report.checks.find((c: { name: string }) => c.name.startsWith("Turn 1: Will's judge"))).toMatchObject({ ok: false, detail: expect.stringContaining("not confirmed: Not confirmed: NEX-1 (Build calendar view) shares no words") });
    expect(heading.report.checks.find((c: { name: string }) => c.name.startsWith("Turn 1: Hein's calendar"))).toMatchObject({ ok: true });
  });
});

describe("turn evaluation", () => {
  const actions = { handle: "S1", label: "Kickoff › Actions", target: { kind: "note", path: "meetings/2026-11-24 kickoff.md", headingSlug: "actions", headingText: "Actions" } };
  const nex1 = { handle: "S2", label: "NEX-1 Build calendar view", target: { kind: "issue", key: "NEX-1" } };
  const nex2 = { handle: "S3", label: "NEX-2 Write the judge instructions", target: { kind: "issue", key: "NEX-2" } };
  const entry = (action: string, status: "tracked" | "untracked", issues: string[], confirmed = true) => ({ action, source: "S1", status, issues, reason: "", confirmed, problem: confirmed ? null : "Not confirmed: test" });
  const JUDGE = "Will writes the judge instructions";
  const CAL = "Hein builds the calendar view";
  const message = (facts: Array<{ text: string; sources: string[] }>, tracking: unknown[]) => ({
    status: "complete",
    answer: { facts, discrepancies: [], suggestions: [], tracking, insufficientEvidence: false, insufficientReason: null, citations: { S1: actions, S2: nex1, S3: nex2 } },
  });
  const issues1 = new Set(["NEX-1"]);
  const issues2 = new Set(["NEX-1", "NEX-2"]);
  const failed = (m: unknown, turn: 1 | 2, existingIssues = turn === 1 ? issues1 : issues2) =>
    evaluateTurn(m, turn, { actionsHeadingExists: true, existingIssues }).filter((c) => !c.ok).map((c) => c.name.replace(/^Turn \d: /, ""));

  it("does not pass a sentence that cites NEX-1 but denies the calendar match (Codex, evaluator bug 1)", () => {
    const m = message([
      { text: "“Will writes the judge instructions” has no matching issue.", sources: ["S1"] },
      { text: "NEX-1 does not track the calendar work.", sources: ["S1", "S2"] },
    ], []);
    expect(failed(m, 1)).toEqual(expect.arrayContaining([
      "Will's judge instructions are untracked, from the Actions heading, confirmed by the evidence",
      "Hein's calendar work is tracked by NEX-1, from the Actions heading, confirmed by the evidence",
    ]));
    // A correct entry next to a confirmed entry that says the opposite fails too.
    expect(failed(message([], [entry(JUDGE, "untracked", []), entry(CAL, "tracked", ["S2"]), entry(CAL, "untracked", [])]), 1)).toEqual(["no confirmed entry contradicts these"]);
  });

  it("passes a correct answer whatever order its NEX-1 citations come in (Codex, evaluator bug 2)", () => {
    const m = message([
      { text: "NEX-1 is in progress and due on 5 December.", sources: ["S2"] }, // the first NEX-1 citation is about status
      { text: "The kickoff lists two actions.", sources: ["S1"] },
    ], [entry(JUDGE, "untracked", []), entry(CAL, "tracked", ["S2"])]);
    expect(failed(m, 1)).toEqual([]);
  });

  it("requires the evidence to confirm each entry, and NEX-2 in the second turn", () => {
    expect(failed(message([], [entry(JUDGE, "untracked", [], false), entry(CAL, "tracked", ["S2"])]), 1))
      .toEqual(["Will's judge instructions are untracked, from the Actions heading, confirmed by the evidence"]);
    const secondTurn = message([], [entry(JUDGE, "tracked", ["S3"]), entry(CAL, "tracked", ["S2"])]);
    expect(failed(secondTurn, 2)).toEqual([]);
    // In the second turn, a confirmed "untracked" entry is wrong and contradicts the expected one.
    expect(failed(message([], [entry(JUDGE, "untracked", []), entry(CAL, "tracked", ["S2"])]), 2))
      .toEqual(["Will's judge instructions are tracked by NEX-2, from the Actions heading, confirmed by the evidence", "no confirmed entry contradicts these"]);
    expect(failed(secondTurn, 2, issues1)).toEqual(["the NEX-2 citation opens"]); // cited, but the issue does not exist
    expect(evaluateTurn(secondTurn, 2, { actionsHeadingExists: false, existingIssues: issues2 }).find((c) => c.name.endsWith("the Actions heading citation opens"))?.ok).toBe(false);
  });

  // R4-4 (Codex review of run 4): correct structured entries plus a recorded free-text fact
  // that denies the calendar match passed every first-turn check.
  const sentence = { judgeMissing: "“Will writes the judge instructions” has no matching issue.", calendar: "“Hein builds the calendar view” is tracked by NEX-1 (Build calendar view, in progress)." };
  it("fails a correct answer whose recorded facts also contradict it, in either turn (R4-4)", () => {
    const right = [entry(JUDGE, "untracked", []), entry(CAL, "tracked", ["S2"])];
    const shown = (extra: Array<{ text: string; sources: string[] }>) => message([{ text: sentence.judgeMissing, sources: ["S1"] }, { text: sentence.calendar, sources: ["S1", "S2"] }, ...extra], right);
    expect(failed(shown([]), 1)).toEqual([]);
    for (const text of ["NEX-1 does not track the calendar work.", "No issue tracks the calendar view yet.", "The calendar view is not on the board."]) {
      expect(failed(shown([{ text, sources: ["S1", "S2"] }]), 1), text).toEqual(["the recorded facts and discrepancies say nothing else about these actions"]);
    }
    // Turn 2: a stray fact that the judge instructions are still missing fails as well.
    const turn2 = message([{ text: "The judge instructions are still missing.", sources: ["S1"] }], [entry(JUDGE, "tracked", ["S3"]), entry(CAL, "tracked", ["S2"])]);
    expect(failed(turn2, 2)).toEqual(["the recorded facts and discrepancies say nothing else about these actions"]);
    // A discrepancy that cites the issue tracking the action is a fair statement about it.
    const disc = { ...shown([]), answer: { ...shown([]).answer, discrepancies: [{ text: "The note marks “Hein builds the calendar view” as not done, but NEX-1 is in progress.", sources: ["S1", "S2"] }] } };
    expect(failed(disc, 1)).toEqual([]);
  });

  it("uses no kickoff words: the same rules in a second fictional workspace (R4-4)", () => {
    const planning = {
      notePath: "standups/2026-11-20 planning.md", headingSlug: "action-items", heading: "Action items",
      missing: { action: "Priya drafts the onboarding guide", label: "Priya's onboarding guide", issueAfter: "OPS-2" },
      tracked: { action: "Tomasz migrates the billing tests", label: "Tomasz's billing tests", issue: "OPS-1" },
    };
    const cites = {
      S1: { handle: "S1", label: "Planning › Action items", target: { kind: "note", path: planning.notePath, headingSlug: "action-items", headingText: "Action items" } },
      S2: { handle: "S2", label: "OPS-1 Migrate the billing tests", target: { kind: "issue", key: "OPS-1" } },
      S3: { handle: "S3", label: "OPS-2 Draft the onboarding guide", target: { kind: "issue", key: "OPS-2" } },
    };
    const msg = (facts: Array<{ text: string; sources: string[] }>, tracking: unknown[]) => ({ status: "complete", answer: { facts, discrepancies: [], suggestions: [], tracking, insufficientEvidence: false, insufficientReason: null, citations: cites } });
    const run = (m: unknown, turn: 1 | 2) => evaluateTurn(m, turn, { actionsHeadingExists: true, existingIssues: new Set(turn === 1 ? ["OPS-1"] : ["OPS-1", "OPS-2"]), scenario: planning }).filter((c) => !c.ok).map((c) => c.name.replace(/^Turn \d: /, ""));
    const turn1 = [entry(planning.missing.action, "untracked", []), entry(planning.tracked.action, "tracked", ["S2"])];
    expect(run(msg([], turn1), 1)).toEqual([]);
    expect(run(msg([{ text: "OPS-1 is unrelated to the billing tests.", sources: ["S1", "S2"] }], turn1), 1)).toEqual(["the recorded facts and discrepancies say nothing else about these actions"]);
    expect(run(msg([], [entry(planning.missing.action, "tracked", ["S3"]), entry(planning.tracked.action, "tracked", ["S2"])]), 2)).toEqual([]);
    expect(run(msg([], turn1), 2)).toEqual(["Priya's onboarding guide are tracked by OPS-2, from the Action items heading, confirmed by the evidence", "no confirmed entry contradicts these"]);
  });
});

describe("workspace hashes", () => {
  it("cover notes, projects and issues, and leave conversations out", async () => {
    const dir = await mkdtemp(join(out, "hash-"));
    await mkdir(join(dir, ".nexus", "conversations"), { recursive: true });
    await mkdir(join(dir, "meetings"), { recursive: true });
    await writeFile(join(dir, "meetings", "a.md"), "# A\n");
    await writeFile(join(dir, ".nexus", "issues.json"), "{}\n");
    await writeFile(join(dir, ".nexus", "conversations", "cnv_x.json"), "{}\n");
    const before = await workspaceHashes(dir);
    expect(Object.keys(before).sort()).toEqual([".nexus/issues.json", "meetings/a.md"]);
    await writeFile(join(dir, ".nexus", "conversations", "cnv_x.json"), "{\"changed\":true}\n");
    expect(await workspaceHashes(dir)).toEqual(before);
    await writeFile(join(dir, "meetings", "a.md"), "# A changed\n");
    expect((await workspaceHashes(dir))["meetings/a.md"]).not.toBe(before["meetings/a.md"]);
  });
});
