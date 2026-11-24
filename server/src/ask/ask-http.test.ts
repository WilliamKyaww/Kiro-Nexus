// Slice C3 over HTTP against the real service and the deterministic provider double
// (a labelled fixture, not AI): availability, runs, cancellation, failure, restart.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

const KEY = "nexus-fake-ask-key-3b9e";
let double: ProviderDouble;
let base: string;
let ws: string;
const running: RunningService[] = [];
beforeAll(async () => { double = await startProviderDouble(); });
afterAll(async () => { await double.close(); });
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-ask-http-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
});
afterEach(async () => {
  for (const s of running.splice(0)) if (s.child.exitCode === null) await s.stop();
  await rm(base, { recursive: true, force: true });
});

async function hashes(dir: string, skip: RegExp): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const name of await readdir(d)) {
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (skip.test(rel)) continue;
      if ((await stat(p)).isDirectory()) await walk(p);
      else out[rel] = createHash("sha256").update(await readFile(p)).digest("hex");
    }
  };
  await walk(dir);
  return out;
}

async function setup(model = "nexus-test-double") {
  const svc = await startService({ profile: join(base, "profile"), workspace: ws });
  running.push(svc);
  const api = client(svc, await openSession(svc));
  const off = (await api.get("/ask/status")).body;
  expect(off).toMatchObject({ available: false, reason: "no-profile" });
  const p = (await api.post("/providers", { name: "Test double", baseUrl: double.baseUrl, model })).body;
  expect((await api.get("/ask/status")).body).toMatchObject({ available: false, reason: "no-key" });
  await api.put(`/providers/${p.id}/session-key`, { key: KEY });
  expect((await api.get("/ask/status")).body.reason).toBe("untested");
  await api.post(`/providers/${p.id}/test`);
  expect((await api.get("/ask/status")).body).toMatchObject({ available: true, profile: { model, fixture: true } });
  return { svc, api, profileId: p.id };
}

async function waitForAnswer(api: ReturnType<typeof client>, conversationId: string, count: number) {
  for (let i = 0; i < 100; i++) {
    const c = (await api.get(`/conversations/${conversationId}`)).body;
    const answers = c.messages.filter((m: { role: string; status: string }) => m.role === "assistant" && m.status !== "running");
    if (answers.length >= count) return c;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no answer");
}

describe("Ask over HTTP", () => {
  it("answers, stores only the conversation, and pins the model", async () => {
    const { api } = await setup();
    const before = await hashes(ws, /^\.nexus\/conversations/);
    const conv = (await api.post("/conversations", {})).body;
    const started = await api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" });
    expect(started.status).toBe(202);
    const c = await waitForAnswer(api, conv.id, 1);
    const answer = c.messages[1];
    expect(answer.status).toBe("complete");
    expect(answer.meta).toMatchObject({ model: "nexus-test-double", fixture: true, mode: "tools" });
    expect(answer.answer.facts.map((f: { text: string }) => f.text).join("\n")).toMatch(/judge instructions.*has no matching issue/);
    expect(c.title).toBe("Which action from the kickoff still has no issue?");
    expect(await hashes(ws, /^\.nexus\/conversations/)).toEqual(before);
    const stored = await readFile(join(ws, ".nexus", "conversations", `${conv.id}.json`), "utf8");
    expect(stored).not.toContain(KEY);
    expect((await api.get("/conversations")).body.conversations).toMatchObject([{ id: conv.id, messages: 2 }]);
  });

  it("cancels a slow run, reports a rejected key distinctly, and survives a restart mid-run", async () => {
    let { svc, api, profileId } = await setup("nexus-test-double-slow");
    const conv = (await api.post("/conversations", {})).body;
    const { runId } = (await api.post(`/conversations/${conv.id}/ask`, { question: "Which action still has no issue?" })).body;
    expect((await api.post(`/conversations/${conv.id}/ask`, { question: "A second question at once" })).status).toBe(409);
    await new Promise((r) => setTimeout(r, 200));
    expect((await api.post(`/ask-runs/${runId}/cancel`)).body.wasRunning).toBe(true);
    let c = await waitForAnswer(api, conv.id, 1);
    expect(c.messages[1]).toMatchObject({ status: "cancelled", error: { code: "CANCELLED" } });

    await api.put(`/providers/${profileId}/session-key`, { key: "invalid-key" });
    await api.post(`/conversations/${conv.id}/ask`, { question: "Which action still has no issue?" });
    c = await waitForAnswer(api, conv.id, 2);
    expect(c.messages[3]).toMatchObject({ status: "failed", error: { code: "PROVIDER_AUTH" } });
    expect(c.messages[3].error.message).toContain("rejected the key");

    // A run interrupted by a crash is marked failed on the next start, so the UI offers Retry.
    await api.put(`/providers/${profileId}/session-key`, { key: KEY });
    await api.post(`/conversations/${conv.id}/ask`, { question: "Which action still has no issue?" });
    await new Promise((r) => setTimeout(r, 300));
    svc.child.kill("SIGKILL");
    await svc.exited;
    running.splice(0);
    svc = await startService({ profile: join(base, "profile"), workspace: ws });
    running.push(svc);
    api = client(svc, await openSession(svc));
    c = (await api.get(`/conversations/${conv.id}`)).body;
    expect(c.messages).toHaveLength(6);
    expect(c.messages[5]).toMatchObject({ status: "failed", error: { code: "INTERRUPTED" } });
    // Keys were session-only in this browser-style run, so AI is off again after the restart.
    expect((await api.get("/ask/status")).body.reason).toBe("no-key");
  });
});
