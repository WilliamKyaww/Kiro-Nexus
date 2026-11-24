// Live check for Q1 (run by a human with their own free key; Kiro does not run it).
// Uses a disposable copy of the fictional sample and an isolated profile, so no real data
// leaves the machine. The key is read from an environment variable you set for this run
// only; it is sent to the provider and nowhere else, and is not written to disk.
//
//   $env:NEXUS_LIVE_KEY = "<your free key>"; npm run live:check
//   Optional: $env:NEXUS_LIVE_BASE_URL (default https://api.groq.com/openai/v1)
//             $env:NEXUS_LIVE_MODEL    (default openai/gpt-oss-20b)
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { repoRoot } from "./launcher-lib.mjs";

const key = process.env.NEXUS_LIVE_KEY;
if (!key) { console.error("Set NEXUS_LIVE_KEY for this command only. Nothing was sent."); process.exit(1); }
const baseUrl = process.env.NEXUS_LIVE_BASE_URL ?? "https://api.groq.com/openai/v1";
const model = process.env.NEXUS_LIVE_MODEL ?? "openai/gpt-oss-20b";
const question = "Which action from the kickoff still has no issue?";

const base = await mkdtemp(join(tmpdir(), "nexus-live-"));
const ws = join(base, "ws");
await cp(join(repoRoot, "samples", "meeting-workspace"), ws, { recursive: true });
const child = spawn(process.execPath, [join(repoRoot, "server", "dist", "main.mjs"), "--profile", join(base, "profile"), "--workspace", ws], { stdio: ["ignore", "pipe", "ignore"] });
const port = await new Promise((resolve, reject) => {
  createInterface({ input: child.stdout }).on("line", (l) => { try { const m = JSON.parse(l); if (m.event === "ready") resolve(m.port); } catch { /* ignore */ } });
  child.once("exit", () => reject(new Error("service exited")));
});
const info = JSON.parse(await readFile(join(base, "profile", "service.json"), "utf8"));
const control = { authorization: `Bearer ${info.controlSecret}` };
const { launchCode } = await (await fetch(`http://127.0.0.1:${port}/api/v1/launch-codes`, { method: "POST", headers: control })).json();
const { token } = await (await fetch(`http://127.0.0.1:${port}/api/v1/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchCode }) })).json();
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const result = { date: new Date().toISOString(), provider: new URL(baseUrl).host, baseUrl, model, capabilities: null, answer: null, error: null };
try {
  const p = (await call("POST", "/providers", { name: "Live check", baseUrl, model })).body;
  await call("PUT", `/providers/${p.id}/session-key`, { key });
  const tested = await call("POST", `/providers/${p.id}/test`);
  result.capabilities = tested.body.profile?.capabilities ?? { error: tested.body.error?.message };
  console.log("Capabilities:", JSON.stringify(result.capabilities));
  if (tested.status === 200) {
    const conv = (await call("POST", "/conversations", {})).body;
    await call("POST", `/conversations/${conv.id}/ask`, { question });
    for (let i = 0; i < 360; i++) {
      const c = (await call("GET", `/conversations/${conv.id}`)).body;
      const a = c.messages.find((m) => m.role === "assistant" && m.status !== "running");
      if (a) { result.answer = { status: a.status, error: a.error, meta: a.meta, answer: a.answer }; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
} catch (e) {
  result.error = String(e?.message ?? e).split(key).join("[redacted]");
} finally {
  await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, { method: "POST", headers: control }).catch(() => undefined);
}
const outDir = join(repoRoot, ".tmp", "live-check");
await mkdir(outDir, { recursive: true });
const file = join(outDir, `live-check-${result.date.replace(/[:.]/g, "-")}.json`);
await writeFile(file, JSON.stringify(result, null, 2).split(key).join("[redacted]"));
await rm(base, { recursive: true, force: true });
console.log(result.answer ? `Answer status: ${result.answer.status}. Facts:\n${(result.answer.answer?.facts ?? []).map((f) => ` - ${f.text}`).join("\n")}` : `No answer. ${result.error ?? ""}`);
console.log(`Result saved to ${file} (no key in it). Record provider, model, date and capabilities in docs/judge-ai-route.md and STATE.md.`);
