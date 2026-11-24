// The live-check CLI (scripts/live-ask-check.mjs), run as a real child process against the
// deterministic test double (a fixture, not AI). Reproduced on e61a3d4: the bodyless POST to
// /providers/:id/test declared application/json, got 400 before reaching the provider, and
// the command still exited 0.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { EXIT, evaluateAnswer } from "../../../scripts/live-ask-check.mjs";

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
  it("reaches the provider, passes every answer check, and still refuses to call a fixture a live pass", async () => {
    const before = double.requests.length;
    const r = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double" });
    expect(r.code).toBe(EXIT.fixture);
    expect(double.requests.length - before).toBeGreaterThanOrEqual(3); // two probes plus the Ask run
    expect(r.report).toMatchObject({ verdict: "fixture, not a live pass", exitCode: EXIT.fixture, liveProvider: false, capabilities: { toolCalling: "yes", structuredOutput: "yes", fixture: true } });
    expect(r.report.checks.map((c: { name: string; ok: boolean }) => [c.name, c.ok])).toEqual([
      ["answer completed", true],
      ["evidence sufficient", true],
      ["names the judge-instructions action as missing (as a recorded fact)", true],
      ["that fact cites the Actions heading", true],
      ["cites NEX-1 as tracking the calendar work", true],
      ["the Actions heading citation opens", true],
      ["the NEX-1 citation opens", true],
    ]);
    expect(r.stdout).toContain("never counts as a live pass");
    expect(alive(r.report.servicePid)).toBe(false);
    expect(r.stdout + JSON.stringify(r.report)).not.toContain(KEY);
  });

  it.each([
    ["a rejected key", { NEXUS_LIVE_KEY: "invalid-key", NEXUS_LIVE_MODEL: "nexus-test-double" }, EXIT.auth, /PROVIDER_AUTH/],
    ["a model without tools or structured output", { NEXUS_LIVE_MODEL: "nexus-test-double-none" }, EXIT.unsupported, /neither tool calling nor structured output/],
    ["an answer that takes too long", { NEXUS_LIVE_MODEL: "nexus-test-double-slow", NEXUS_LIVE_ANSWER_TIMEOUT_MS: "1500" }, EXIT.timeout, /No answer within 2 s/],
    ["an insufficient-evidence answer", { NEXUS_LIVE_MODEL: "nexus-test-double-unsure" }, EXIT.checkFailed, /answer checks? failed/],
    ["an answer without the NEX-1 citation", { NEXUS_LIVE_MODEL: "nexus-test-double-nocite" }, EXIT.checkFailed, /answer checks? failed/],
    ["a missing key", { NEXUS_LIVE_KEY: "" }, EXIT.setup, /Set NEXUS_LIVE_KEY/],
  ])("fails with a distinct status for %s", async (_name, env, exit, message) => {
    const r = await runCli(env);
    expect(r.code).toBe(exit);
    expect(r.stdout + r.stderr).toMatch(message);
    if (r.report.servicePid) expect(alive(r.report.servicePid)).toBe(false);
    if (exit !== EXIT.setup) expect(r.report.exitCode).toBe(exit);
  });

  it("records which check failed", async () => {
    const unsure = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double-unsure" });
    expect(unsure.report.checks.find((c: { name: string }) => c.name === "evidence sufficient")).toMatchObject({ ok: false });
    const nocite = await runCli({ NEXUS_LIVE_MODEL: "nexus-test-double-nocite" });
    expect(nocite.report.checks.find((c: { name: string }) => c.name === "cites NEX-1 as tracking the calendar work")).toMatchObject({ ok: false });
    expect(nocite.report.checks.find((c: { name: string }) => c.name === "names the judge-instructions action as missing (as a recorded fact)")).toMatchObject({ ok: true });
  });
});

describe("answer evaluation", () => {
  const actions = { handle: "S1", label: "Kickoff › Actions", target: { kind: "note", path: "meetings/2026-11-24 kickoff.md", headingSlug: "actions", headingText: "Actions" } };
  const nex1 = { handle: "S2", label: "NEX-1 Build calendar view", target: { kind: "issue", key: "NEX-1" } };
  const message = (facts: Array<{ text: string; sources: string[] }>) => ({
    status: "complete",
    answer: { facts, discrepancies: [], suggestions: [], insufficientEvidence: false, insufficientReason: null, citations: { S1: actions, S2: nex1 } },
  });
  const ok = (m: unknown) => evaluateAnswer(m, { actionsHeadingExists: true, nex1Exists: true }).every((c) => c.ok);

  it("accepts the ways a real model might phrase the answer", () => {
    for (const missing of [
      "Will writes the judge instructions has no matching issue.",
      "There is no issue yet for the action “Will writes the judge instructions”.",
      "The judge instructions action is not tracked by any issue.",
      "Writing the judge instructions remains untracked.",
    ]) {
      expect(ok(message([{ text: missing, sources: ["S1"] }, { text: "NEX-1 tracks Hein's calendar view.", sources: ["S1", "S2"] }]))).toBe(true);
    }
  });

  it("rejects an answer that omits the Actions citation or a citation target that no longer exists", () => {
    const m = message([{ text: "The judge instructions action has no issue.", sources: ["S2"] }, { text: "NEX-1 tracks the calendar view.", sources: ["S2"] }]);
    expect(ok(m)).toBe(false);
    const good = message([{ text: "The judge instructions action has no issue.", sources: ["S1"] }, { text: "NEX-1 tracks the calendar view.", sources: ["S2"] }]);
    expect(evaluateAnswer(good, { actionsHeadingExists: false, nex1Exists: true }).find((c) => c.name === "the Actions heading citation opens")?.ok).toBe(false);
  });
});
