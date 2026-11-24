// Live check for Q1, run by Will with his own free key. Kiro does not run it live.
// It uses a disposable copy of the fictional sample and an isolated profile in the
// system temp folder, so no real notes leave the machine.
//
//   npm run build
//   npm run live:check        then paste the key at the masked prompt
//
// The key is read at a prompt that echoes "*", so it never appears on screen, in shell
// history or in an environment variable. It is sent to the disposable service over its
// API and from there only to the provider. Both processes exit and the temporary profile
// is deleted at the end; reports and console output are sanitised.
//
// Optional settings (environment variables):
//   NEXUS_LIVE_BASE_URL   default https://api.groq.com/openai/v1
//   NEXUS_LIVE_MODEL      default openai/gpt-oss-20b
//   NEXUS_LIVE_KEY        the key, for automated runs only (tests); removed from the
//                         environment at once and never passed to the service process
//   NEXUS_LIVE_OUT_DIR    where the report goes (default .tmp/live-check)
//   NEXUS_LIVE_ANSWER_TIMEOUT_MS  how long to wait for the answer (default 240000)
//
// Exit status: 0 live pass; 1 the answer failed a check; 2 setup or service error;
// 3 the provider rejected the key; 4 timed out; 5 the model lacks tool calling and
// structured output; 6 the transport worked but the provider was the test double
// (a fixture never counts as a live pass); 7 other provider error.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { redactSecrets, sanitiseDeep, sanitiseDiagnostic } from "../server/src/providers/sanitise.mjs";
import { repoRoot } from "./launcher-lib.mjs";

export const EXIT = { pass: 0, checkFailed: 1, setup: 2, auth: 3, timeout: 4, unsupported: 5, fixture: 6, provider: 7 };
const QUESTION = "Which action from the kickoff still has no issue?";
const NOTE_PATH = "meetings/2026-11-24 kickoff.md";
const STARTUP_MS = 20_000;
const REQUEST_MS = 15_000;
const PROBE_MS = 150_000; // two probes, each up to 30 s with one retry
const POLL_MS = 500;

class CheckError extends Error {
  constructor(exit, message) { super(message); this.exit = exit; }
}

const providerExit = (code) => ({ PROVIDER_AUTH: EXIT.auth, PROVIDER_TIMEOUT: EXIT.timeout, CANCELLED: EXIT.timeout }[code] ?? EXIT.provider);

/** SHA-256 of every note and of the project and issue data (conversations, lock and state excluded). */
export async function workspaceHashes(dir) {
  const out = {};
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (rel === ".nexus/conversations" || rel === ".nexus/state" || rel === ".nexus/reviews") continue;
        await walk(p);
      } else if (rel.endsWith(".md") || rel === ".nexus/issues.json" || rel === ".nexus/projects.json") {
        out[rel] = createHash("sha256").update(await readFile(p)).digest("hex");
      }
    }
  };
  await walk(dir);
  return out;
}

/** The issue created between the two turns, through the ordinary issue API. */
export const NEW_ISSUE_TITLE = "Write the judge instructions";

/**
 * The journey the check expects, in one fictional workspace. The kickoff sample is the one the
 * CLI runs; the tests also use a second vocabulary, so nothing in the evaluator depends on the
 * kickoff's words (R4-4).
 */
export const KICKOFF = {
  notePath: NOTE_PATH, headingSlug: "actions", heading: "Actions",
  missing: { action: "Will writes the judge instructions", label: "Will's judge instructions", issueAfter: "NEX-2" },
  tracked: { action: "Hein builds the calendar view", label: "Hein's calendar work", issue: "NEX-1" },
};

// The same content words Nexus uses (server/src/ask/answer.ts contentWords).
const contentWords = (text) => new Set((String(text).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).map((w) => w.replace(/(ings?|ed|es|s)$/, "").replace(/e$/, "")).filter((w) => w.length >= 3));
/** Whether a tracking entry is for an action: at least half of the action's content words appear in it. */
const refersTo = (text, action) => {
  const want = contentWords(action);
  const have = contentWords(text);
  return want.size > 0 && [...want].filter((w) => have.has(w)).length / want.size >= 0.5;
};
/** The words that identify an action, without its leading owner ("Hein builds …"); as in answer.ts actionWords. */
const actionWords = (action) => {
  const tokens = String(action).trim().split(/\s+/);
  const owner = tokens.length >= 3 && /^[A-Z][a-z]+$/.test(tokens[0]) && /^[a-z]+s$/.test(tokens[1]) ? [...contentWords(tokens[0])][0] : null;
  const words = contentWords(action);
  if (owner) words.delete(owner);
  return words;
};
/** Whether a recorded statement is about an action: it shares a word that identifies the action. */
const isAbout = (text, action) => { const have = contentWords(text); return [...actionWords(action)].some((w) => have.has(w)); };

/**
 * Pure evaluation of one stored answer in the two-turn journey (also used by the browser
 * test). It reads the structured tracking entries, which Nexus has already checked against
 * the run's evidence, and then checks everything the answer shows as recorded:
 *   turn 1: the missing action is untracked, and the tracked action's issue tracks it;
 *   turn 2 (after the new issue is created): the new issue tracks the missing action too.
 * A recorded fact or discrepancy about either action that is not Nexus's own sentence for a
 * correct, confirmed entry fails the turn, whatever its wording (R4-4).
 */
export function evaluateTurn(message, turn, { actionsHeadingExists, existingIssues, scenario = KICKOFF }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name: `Turn ${turn}: ${name}`, ok, detail });
  const a = message?.answer;
  add("answer completed", message?.status === "complete" && !!a, message?.status ?? "no answer");
  if (!a) return checks;
  add("evidence sufficient", !a.insufficientEvidence, a.insufficientEvidence ? (a.insufficientReason ?? "insufficient evidence") : "ok");
  const { missing, tracked, heading } = scenario;
  const cites = a.citations ?? {};
  const isSection = (h) => cites[h]?.target?.kind === "note" && cites[h].target.path === scenario.notePath && cites[h].target.headingSlug === scenario.headingSlug;
  const isIssue = (key) => (h) => cites[h]?.target?.kind === "issue" && cites[h].target.key === key;
  const keyOf = (h) => cites[h]?.target?.key ?? h;
  const entries = (a.tracking ?? []);
  const describe = (list) => list.length ? list.map((t) => `${t.status}${t.issues.length ? ` by ${t.issues.map(keyOf).join(", ")}` : ""}${t.confirmed ? "" : ` (not confirmed: ${t.problem})`}`).join("; ") : "no tracking entry for this action";
  const forMissing = entries.filter((t) => refersTo(t.action, missing.action));
  const forTracked = entries.filter((t) => refersTo(t.action, tracked.action));
  const missingIssue = turn === 1 ? null : missing.issueAfter;
  const missingOk = (t) => t.confirmed && isSection(t.source) && (missingIssue === null ? t.status === "untracked" : t.status === "tracked" && t.issues.some(isIssue(missingIssue)));
  const trackedOk = (t) => t.confirmed && isSection(t.source) && t.status === "tracked" && t.issues.some(isIssue(tracked.issue));
  add(missingIssue === null
    ? `${missing.label} are untracked, from the ${heading} heading, confirmed by the evidence`
    : `${missing.label} are tracked by ${missingIssue}, from the ${heading} heading, confirmed by the evidence`, forMissing.some(missingOk), describe(forMissing));
  add(`${tracked.label} is tracked by ${tracked.issue}, from the ${heading} heading, confirmed by the evidence`, forTracked.some(trackedOk), describe(forTracked));
  // A correct entry must not sit beside a confirmed entry that says the opposite.
  const contradictions = [...forMissing.filter((t) => t.confirmed && !missingOk(t)), ...forTracked.filter((t) => t.confirmed && !trackedOk(t))];
  add("no confirmed entry contradicts these", contradictions.length === 0, contradictions.length ? describe(contradictions) : "none");
  // Everything shown as recorded about these actions must be Nexus's sentence for a correct
  // entry, or a discrepancy that cites the issue that tracks the action.
  const correctSentence = (text, action, issueKey) => issueKey === null
    ? text === `“${action}” has no matching issue.`
    : text.startsWith(`“${action}” is tracked by ${issueKey} (`);
  const stray = [];
  for (const [kind, list] of [["fact", a.facts ?? []], ["discrepancy", a.discrepancies ?? []]]) {
    for (const item of list) {
      for (const [action, issueKey] of [[missing.action, missingIssue], [tracked.action, tracked.issue]]) {
        if (!isAbout(item.text, action)) continue;
        const ok = kind === "fact"
          ? correctSentence(item.text, action, issueKey)
          : issueKey !== null && (item.sources ?? []).some(isIssue(issueKey));
        if (!ok) stray.push(`${kind}: ${item.text}`);
      }
    }
  }
  add("the recorded facts and discrepancies say nothing else about these actions", stray.length === 0, stray.length ? stray.join(" | ") : "none");
  add(`the ${heading} heading citation opens`, Object.keys(cites).some(isSection) && actionsHeadingExists, actionsHeadingExists ? "heading exists" : "heading not found");
  for (const key of missingIssue === null ? [tracked.issue] : [tracked.issue, missingIssue]) {
    add(`the ${key} citation opens`, Object.keys(cites).some(isIssue(key)) && existingIssues.has(key), existingIssues.has(key) ? (Object.keys(cites).some(isIssue(key)) ? "cited and exists" : "not cited") : "issue not found");
  }
  return checks;
}

/** Remove the key, fragments of it and key-shaped strings, keeping the layout. */
export function sanitiseReport(text, keys) {
  return redactSecrets(text, keys);
}

/**
 * Read a line from a terminal without showing it: each character echoes as "*".
 * Returns null when the input is not a terminal. Raw mode is always restored.
 */
export function promptHidden(question, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== "function") return Promise.resolve(null);
  output.write(question);
  return new Promise((resolve) => {
    let value = "";
    const finish = (result) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(result);
    };
    const onData = (chunk) => {
      const raw = String(chunk);
      if (raw === "\u001b") return finish(null); // Esc on its own: give up
      // Drop bracketed-paste markers and cursor keys rather than treating them as input.
      const text = raw.replace(/\u001b\[[0-9;]*[A-Za-z~]/g, "");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n") return finish(value);
        if (ch === "\u0003") return finish(null); // Ctrl+C: give up
        if (ch === "\u007f" || ch === "\b") {
          if (value) { value = value.slice(0, -1); output.write("\b \b"); }
          continue;
        }
        if (ch < " ") continue;
        value += ch;
        output.write("*");
      }
    };
    input.setRawMode(true);
    input.setEncoding?.("utf8");
    input.on("data", onData);
    input.resume();
  });
}

let activeKey = "";
/** Console output passes through the same sanitiser as the report. */
const say = (line) => console.log(sanitiseDiagnostic(line, { keys: [activeKey], max: 2000 }));

async function readKey() {
  // A key in the environment works for automation, but is removed at once so that the
  // service child process and anything else started from here never inherit it.
  const fromEnv = process.env.NEXUS_LIVE_KEY?.trim();
  delete process.env.NEXUS_LIVE_KEY;
  if (fromEnv) return fromEnv;
  const typed = await promptHidden("Paste your provider key (it is not shown, saved or logged), then press Enter: ");
  return typed?.trim() || null;
}

async function main() {
  const key = await readKey();
  activeKey = key ?? "";
  if (!key) throw new CheckError(EXIT.setup, "No key was given. Run npm run live:check in a terminal and paste the key when asked. Nothing was sent.");
  const baseUrl = process.env.NEXUS_LIVE_BASE_URL ?? "https://api.groq.com/openai/v1";
  const model = process.env.NEXUS_LIVE_MODEL ?? "openai/gpt-oss-20b";
  const answerTimeoutMs = Number(process.env.NEXUS_LIVE_ANSWER_TIMEOUT_MS ?? 240_000);
  const outDir = process.env.NEXUS_LIVE_OUT_DIR ?? join(repoRoot, ".tmp", "live-check");
  const bundle = join(repoRoot, "server", "dist", "main.mjs");
  const report = {
    date: new Date().toISOString(), baseUrl, model, provider: (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })(),
    question: QUESTION, verdict: "error", exitCode: EXIT.setup, liveProvider: null, capabilities: null, checks: [], turns: [], error: null, servicePid: null,
  };
  let child = null;
  let base = null;
  let control = null;
  let port = null;

  const stopService = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    if (port && control) {
      await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, { method: "POST", headers: control, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    }
    const kill = setTimeout(() => child.kill(), 5000);
    let giveUp;
    await Promise.race([exited, new Promise((r) => { giveUp = setTimeout(r, 8000); })]);
    clearTimeout(kill);
    clearTimeout(giveUp);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  // Last resort if the process is torn down: never leave the service running.
  const killNow = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill(); };
  process.once("exit", killNow);
  const onSignal = (sig) => { killNow(); process.exit(128 + (sig === "SIGINT" ? 2 : 15)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    if (!existsSync(bundle)) throw new CheckError(EXIT.setup, "The service is not built. Run: npm run build");
    base = await mkdtemp(join(tmpdir(), "nexus-live-"));
    const ws = join(base, "ws");
    const profile = join(base, "profile");
    await cp(join(repoRoot, "samples", "meeting-workspace"), ws, { recursive: true });
    const env = { ...process.env };
    delete env.NEXUS_LIVE_KEY; // the service gets the key over its API, never through its environment
    child = spawn(process.execPath, [bundle, "--profile", profile, "--workspace", ws], { stdio: ["ignore", "pipe", "pipe"], env });
    report.servicePid = child.pid;
    child.stderr.resume(); // service logs stay in the disposable profile
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CheckError(EXIT.timeout, `The Nexus service did not start within ${STARTUP_MS / 1000} s.`)), STARTUP_MS);
      createInterface({ input: child.stdout }).on("line", (l) => {
        let m;
        try { m = JSON.parse(l); } catch { return; }
        if (m.event === "ready") { clearTimeout(timer); resolve(m.port); }
        if (m.event === "error") { clearTimeout(timer); reject(new CheckError(EXIT.setup, `The Nexus service could not start (${m.code}).`)); }
      });
      child.once("exit", (code) => { clearTimeout(timer); reject(new CheckError(EXIT.setup, `The Nexus service exited during start-up (code ${code}).`)); });
    });
    const info = JSON.parse(await readFile(join(profile, "service.json"), "utf8"));
    control = { authorization: `Bearer ${info.controlSecret}` };

    const http = async (method, path, { body, headers = {}, timeoutMs = REQUEST_MS, expect = [200] } = {}) => {
      let res;
      try {
        res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
          method,
          // Declare JSON only when a body is sent: an empty JSON body is a 400 before any route runs.
          headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (e?.name === "TimeoutError") throw new CheckError(EXIT.timeout, `${method} ${path} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
        throw new CheckError(EXIT.setup, `${method} ${path} failed: ${e?.message ?? e}`);
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!expect.includes(res.status)) {
        const err = new CheckError(EXIT.setup, `${method} ${path} returned ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    };

    const { launchCode } = await http("POST", "/launch-codes", { headers: control });
    const { token } = await http("POST", "/session", { body: { launchCode } });
    const auth = { authorization: `Bearer ${token}` };
    const api = (method, path, opts = {}) => http(method, path, { ...opts, headers: auth });

    const profileView = await api("POST", "/providers", { body: { name: "Live check", baseUrl, model }, expect: [201] });
    await api("PUT", `/providers/${profileView.id}/session-key`, { body: { key } });
    let tested;
    try {
      tested = await api("POST", `/providers/${profileView.id}/test`, { timeoutMs: PROBE_MS });
    } catch (e) {
      const providerCode = e.body?.error?.details?.providerCode;
      if (providerCode) throw new CheckError(providerExit(providerCode), `Provider test failed (${providerCode}): ${e.body.error.message}`);
      throw e;
    }
    const caps = tested?.profile?.capabilities;
    if (!caps) throw new CheckError(EXIT.setup, "The provider test returned no capabilities.");
    report.capabilities = caps;
    say(`Capabilities: tool calling ${caps.toolCalling}, structured output ${caps.structuredOutput}${caps.detail ? ` (${caps.detail})` : ""}`);
    let fixture = caps.fixture === true || /^nexus-test-double/.test(model);
    if (caps.toolCalling !== "yes" && caps.structuredOutput !== "yes") {
      if (caps.toolCalling === "error" || caps.structuredOutput === "error") {
        throw new CheckError(EXIT.provider, `The capability probes failed: ${caps.detail ?? "no detail"}`);
      }
      throw new CheckError(EXIT.unsupported, "The model showed neither tool calling nor structured output, so Ask cannot use it.");
    }

    const conversation = await api("POST", "/conversations", { body: {}, expect: [201] });
    /** Ask in the conversation through the normal Ask path and wait (bounded) for the stored answer. */
    const askAndWait = async (question) => {
      const { runId } = await api("POST", `/conversations/${conversation.id}/ask`, { body: { question }, expect: [202] });
      if (!runId) throw new CheckError(EXIT.setup, "The service accepted the question but returned no run ID.");
      const deadline = Date.now() + answerTimeoutMs;
      for (;;) {
        if (Date.now() > deadline) {
          await api("POST", `/ask-runs/${runId}/cancel`, { body: {} }).catch(() => undefined);
          throw new CheckError(EXIT.timeout, `No answer within ${Math.round(answerTimeoutMs / 1000)} s. The run was cancelled.`);
        }
        const c = await api("GET", `/conversations/${conversation.id}`);
        const message = c.messages.find((m) => m.role === "assistant" && m.runId === runId && m.status !== "running");
        if (message) return message;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    };
    const issueKeys = async () => new Set(((await api("GET", "/issues"))?.issues ?? []).map((i) => i.key));
    const note = await api("GET", `/notes/content?path=${encodeURIComponent(NOTE_PATH)}`);
    const actionsHeadingExists = (note?.headings ?? []).some((h) => h.slug === "actions");
    report.turns = [];
    report.checks = [];

    for (const turn of [1, 2]) {
      if (turn === 2) {
        // The user's manual step between the turns: create the missing issue through the issue API.
        const project = ((await api("GET", "/projects"))?.projects ?? []).find((p) => p.key === "NEX");
        if (!project) throw new CheckError(EXIT.setup, "The disposable sample has no NEX project.");
        const created = await api("POST", "/issues", { body: { projectId: project.id, title: NEW_ISSUE_TITLE }, expect: [201] });
        say(`Created ${created.key} "${NEW_ISSUE_TITLE}" through the issue API.`);
      }
      const before = await workspaceHashes(ws);
      const message = await askAndWait(QUESTION);
      const after = await workspaceHashes(ws);
      const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
      report.turns.push({ turn, question: QUESTION, status: message.status, error: message.error, meta: message.meta, answer: message.answer, changedByAsk: changed });
      fixture ||= message.meta?.fixture === true;
      report.liveProvider = !fixture;
      if (message.status !== "complete") {
        const code = message.error?.code ?? "UNKNOWN";
        throw new CheckError(providerExit(code), `Turn ${turn} was not answered (${code}): ${message.error?.message ?? ""}`);
      }
      const checks = [
        ...evaluateTurn(message, turn, { actionsHeadingExists, existingIssues: await issueKeys() }),
        { name: `Turn ${turn}: Ask left the notes and issues unchanged`, ok: changed.length === 0, detail: changed.length ? `changed: ${changed.join(", ")}` : "byte-for-byte unchanged" },
      ];
      report.checks.push(...checks);
      for (const c of checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
      const failed = checks.filter((c) => !c.ok);
      if (failed.length) throw new CheckError(EXIT.checkFailed, `${failed.length} check${failed.length === 1 ? "" : "s"} failed in turn ${turn}.`);
    }
    if (fixture) throw new CheckError(EXIT.fixture, "The transport and checks worked, but the provider is the local test double, which is a fixture and never counts as a live pass.");
    report.verdict = "live pass";
    report.exitCode = EXIT.pass;
  } catch (e) {
    const exit = e instanceof CheckError ? e.exit : EXIT.setup;
    report.verdict = { [EXIT.checkFailed]: "check failed", [EXIT.auth]: "authentication failed", [EXIT.timeout]: "timed out", [EXIT.unsupported]: "unsupported capabilities", [EXIT.fixture]: "fixture, not a live pass", [EXIT.provider]: "provider error" }[exit] ?? "error";
    report.exitCode = exit;
    report.error = String(e?.message ?? e);
  } finally {
    await stopService();
    process.off("exit", killNow);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (base) await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }

  // Every string in the report is sanitised value by value, so the JSON stays valid.
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `live-check-${report.date.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(sanitiseDeep(report, { keys: [key], max: 4000 }), null, 2) + "\n");
  say(`Result: ${report.verdict} (exit ${report.exitCode}).${report.error ? ` ${report.error}` : ""}`);
  say(`Report saved to ${file}.`);
  if (report.exitCode === EXIT.pass) say("Record the provider, model, date and capabilities in docs/judge-ai-route.md and STATE.md, then close Q1.");
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    const text = sanitiseDiagnostic(String(e?.message ?? e), { keys: [activeKey], max: 2000 });
    console.error(e instanceof CheckError ? text : `live check crashed: ${text}`);
    process.exitCode = e instanceof CheckError ? e.exit : EXIT.setup;
  });
}
