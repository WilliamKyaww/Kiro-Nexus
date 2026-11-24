// Live check for Q1, run by Will with his own free key. Kiro does not run it live.
// It uses a disposable copy of the fictional sample and an isolated profile in the
// system temp folder, so no real notes leave the machine.
//
//   npm run build
//   npm run live:check
//
// Optional settings (environment variables):
//   NEXUS_LIVE_BASE_URL   default https://api.groq.com/openai/v1
//   NEXUS_LIVE_MODEL      default openai/gpt-oss-20b
//   NEXUS_LIVE_KEY        the key, for non-interactive runs only
//   NEXUS_LIVE_OUT_DIR    where the report goes (default .tmp/live-check)
//   NEXUS_LIVE_ANSWER_TIMEOUT_MS  how long to wait for the answer (default 240000)
//
// Exit status: 0 live pass; 1 the answer failed a check; 2 setup or service error;
// 3 the provider rejected the key; 4 timed out; 5 the model lacks tool calling and
// structured output; 6 the transport worked but the provider was the test double
// (a fixture never counts as a live pass); 7 other provider error.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
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

const ABSENCE = /\b(no\b[^.]{0,30}\bissues?\b|not (yet )?(been )?(tracked|covered|created)|untracked|without (an? )?(matching |corresponding )?issue|lacks? (an? )?issue|missing (an? )?issue)/i;

/** Pure evaluation of a stored answer against the Q1 acceptance (also used by tests). */
export function evaluateAnswer(message, { actionsHeadingExists, nex1Exists }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const a = message?.answer;
  add("answer completed", message?.status === "complete" && !!a, message?.status ?? "no answer");
  if (!a) return checks;
  add("evidence sufficient", !a.insufficientEvidence, a.insufficientEvidence ? (a.insufficientReason ?? "insufficient evidence") : "ok");
  const cites = a.citations ?? {};
  const isActions = (h) => cites[h]?.target?.kind === "note" && cites[h].target.path === NOTE_PATH && cites[h].target.headingSlug === "actions";
  const isNex1 = (h) => cites[h]?.target?.kind === "issue" && cites[h].target.key === "NEX-1";
  const facts = a.facts ?? [];
  const missing = facts.find((f) => /judge/i.test(f.text) && /instruction/i.test(f.text) && ABSENCE.test(f.text));
  add("names the judge-instructions action as missing (as a recorded fact)", !!missing, missing ? missing.text : "no recorded fact says the judge-instructions action has no issue");
  add("that fact cites the Actions heading", !!missing && missing.sources.some(isActions), missing ? missing.sources.join(", ") : "n/a");
  const tracked = [...facts, ...(a.discrepancies ?? [])].find((f) => f.sources.some(isNex1));
  add("cites NEX-1 as tracking the calendar work", !!tracked && /calendar/i.test(tracked.text), tracked ? tracked.text : "no fact or discrepancy cites NEX-1");
  add("the Actions heading citation opens", Object.keys(cites).some(isActions) && actionsHeadingExists, actionsHeadingExists ? "heading exists" : "heading not found");
  add("the NEX-1 citation opens", Object.keys(cites).some(isNex1) && nex1Exists, nex1Exists ? "issue exists" : "issue not found");
  return checks;
}

/** Remove the key before anything is shown or saved. */
export function sanitiseReport(text, keys) {
  let out = String(text);
  for (const key of keys.filter((k) => k && k.length >= 6)) out = out.split(key).join("[redacted key]");
  return out;
}

async function main() {
  const key = process.env.NEXUS_LIVE_KEY?.trim();
  if (!key) throw new CheckError(EXIT.setup, "Set NEXUS_LIVE_KEY for this command only. Nothing was sent.");
  const baseUrl = process.env.NEXUS_LIVE_BASE_URL ?? "https://api.groq.com/openai/v1";
  const model = process.env.NEXUS_LIVE_MODEL ?? "openai/gpt-oss-20b";
  const answerTimeoutMs = Number(process.env.NEXUS_LIVE_ANSWER_TIMEOUT_MS ?? 240_000);
  const outDir = process.env.NEXUS_LIVE_OUT_DIR ?? join(repoRoot, ".tmp", "live-check");
  const bundle = join(repoRoot, "server", "dist", "main.mjs");
  const report = {
    date: new Date().toISOString(), baseUrl, model, provider: (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })(),
    question: QUESTION, verdict: "error", exitCode: EXIT.setup, liveProvider: null, capabilities: null, checks: [], answer: null, error: null, servicePid: null,
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
    child = spawn(process.execPath, [bundle, "--profile", profile, "--workspace", ws], { stdio: ["ignore", "pipe", "pipe"] });
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
    console.log(`Capabilities: tool calling ${caps.toolCalling}, structured output ${caps.structuredOutput}${caps.detail ? ` (${caps.detail})` : ""}`);
    let fixture = caps.fixture === true || /^nexus-test-double/.test(model);
    if (caps.toolCalling !== "yes" && caps.structuredOutput !== "yes") {
      if (caps.toolCalling === "error" || caps.structuredOutput === "error") {
        throw new CheckError(EXIT.provider, `The capability probes failed: ${caps.detail ?? "no detail"}`);
      }
      throw new CheckError(EXIT.unsupported, "The model showed neither tool calling nor structured output, so Ask cannot use it.");
    }

    const conversation = await api("POST", "/conversations", { body: {}, expect: [201] });
    const { runId } = await api("POST", `/conversations/${conversation.id}/ask`, { body: { question: QUESTION }, expect: [202] });
    if (!runId) throw new CheckError(EXIT.setup, "The service accepted the question but returned no run ID.");
    const deadline = Date.now() + answerTimeoutMs;
    let message = null;
    while (!message) {
      if (Date.now() > deadline) {
        await api("POST", `/ask-runs/${runId}/cancel`, { body: {} }).catch(() => undefined);
        throw new CheckError(EXIT.timeout, `No answer within ${Math.round(answerTimeoutMs / 1000)} s. The run was cancelled.`);
      }
      const c = await api("GET", `/conversations/${conversation.id}`);
      message = c.messages.find((m) => m.role === "assistant" && m.runId === runId && m.status !== "running") ?? null;
      if (!message) await new Promise((r) => setTimeout(r, POLL_MS));
    }
    report.answer = { status: message.status, error: message.error, meta: message.meta, answer: message.answer };
    fixture ||= message.meta?.fixture === true;
    report.liveProvider = !fixture;
    if (message.status !== "complete") {
      const code = message.error?.code ?? "UNKNOWN";
      throw new CheckError(providerExit(code), `The question was not answered (${code}): ${message.error?.message ?? ""}`);
    }

    const note = await api("GET", `/notes/content?path=${encodeURIComponent(NOTE_PATH)}`);
    const actionsHeadingExists = (note?.headings ?? []).some((h) => h.slug === "actions");
    const nex1Exists = await api("GET", "/issues/NEX-1").then(() => true, () => false);
    report.checks = evaluateAnswer(message, { actionsHeadingExists, nex1Exists });
    for (const c of report.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
    const failed = report.checks.filter((c) => !c.ok);
    if (failed.length) throw new CheckError(EXIT.checkFailed, `${failed.length} answer check${failed.length === 1 ? "" : "s"} failed.`);
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

  const safe = (v) => sanitiseReport(typeof v === "string" ? v : JSON.stringify(v, null, 2), [key ?? ""]);
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `live-check-${report.date.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, safe(report) + "\n");
  console.log(safe(`Result: ${report.verdict} (exit ${report.exitCode}).${report.error ? ` ${report.error}` : ""}`));
  console.log(`Report saved to ${file}.`);
  if (report.exitCode === EXIT.pass) console.log("Record the provider, model, date and capabilities in docs/judge-ai-route.md and STATE.md, then close Q1.");
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    const text = sanitiseReport(String(e?.message ?? e), [process.env.NEXUS_LIVE_KEY ?? ""]);
    console.error(e instanceof CheckError ? text : `live check crashed: ${text}`);
    process.exitCode = e instanceof CheckError ? e.exit : EXIT.setup;
  });
}
