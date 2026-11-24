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

async function setup(model = "nexus-test-double", env?: Record<string, string>) {
  const svc = await startService({ profile: join(base, "profile"), workspace: ws, env });
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

  // Reproduced on e61a3d4: two clients sending at once both got 202, and only one question
  // was stored in the conversation file.
  it("admits one of two simultaneous sends, tells the other it is busy, and stores a consistent transcript", async () => {
    let { svc, api } = await setup();
    const other = client(svc, await openSession(svc)); // a second client with its own session
    const conv = (await api.post("/conversations", {})).body;
    const sends = await Promise.all([
      api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" }),
      other.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff is already tracked?" }),
    ]);
    expect(sends.map((s) => s.status).sort()).toEqual([202, 409]);
    const busy = sends.find((s) => s.status === 409)!;
    expect(busy.body.error).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already answering a question/), details: { reason: "busy" } });
    const admitted = sends.indexOf(sends.find((s) => s.status === 202)!);
    await waitForAnswer(api, conv.id, 1);

    // A burst of six simultaneous sends to another conversation admits exactly one.
    const conv2 = (await api.post("/conversations", {})).body;
    const burst = await Promise.all(Array.from({ length: 6 }, (_, n) => (n % 2 ? other : api).post(`/conversations/${conv2.id}/ask`, { question: `Burst question ${n}?` })));
    expect(burst.filter((s) => s.status === 202)).toHaveLength(1);
    expect(burst.filter((s) => s.status === 409)).toHaveLength(5);
    await waitForAnswer(api, conv2.id, 1);

    // After a restart, each file holds exactly the admitted question and its answer.
    await svc.stop();
    running.splice(0);
    svc = await startService({ profile: join(base, "profile"), workspace: ws });
    running.push(svc);
    api = client(svc, await openSession(svc));
    for (const [id, question] of [[conv.id, admitted === 0 ? "Which action from the kickoff still has no issue?" : "Which action from the kickoff is already tracked?"], [conv2.id, null]] as const) {
      const file = JSON.parse(await readFile(join(ws, ".nexus", "conversations", `${id}.json`), "utf8"));
      expect(file.messages.map((m: { role: string; status: string }) => `${m.role}:${m.status}`)).toEqual(["user:complete", "assistant:complete"]);
      expect(file.messages[0].runId).toBe(file.messages[1].runId);
      if (question) expect(file.messages[0].text).toBe(question);
      expect((await api.get(`/conversations/${id}`)).body.messages).toHaveLength(2);
    }
  });

  // Reproduced on e61a3d4: each run saw only its own question, so "Which of those is already
  // tracked?" had nothing to refer to.
  it.each([
    ["tools", "nexus-test-double"],
    ["retrieval-first", "nexus-test-double-structured"],
  ])("answers a follow-up in %s mode from the conversation and the current workspace", async (mode, model) => {
    const { api } = await setup(model);
    const conv = (await api.post("/conversations", {})).body;
    const ask = async (question: string, count: number) => {
      expect((await api.post(`/conversations/${conv.id}/ask`, { question })).status).toBe(202);
      const c = await waitForAnswer(api, conv.id, count);
      return c.messages.filter((m: { role: string }) => m.role === "assistant")[count - 1];
    };
    const facts = (m: { answer: { facts: Array<{ text: string }> } }) => m.answer.facts.map((f) => f.text).join("\n");
    const first = await ask("Which action from the kickoff still has no issue?", 1);
    expect(first.meta.mode).toBe(mode);
    expect(facts(first)).toMatch(/judge instructions.*has no matching issue/);

    const before = double.requests.length;
    const followUp = await ask("Which of those is already tracked?", 2);
    expect(followUp.status).toBe("complete");
    expect(followUp.answer.insufficientEvidence).toBe(false);
    expect(facts(followUp)).toMatch(/Hein builds the calendar view.*tracked by NEX-1/);
    expect(facts(followUp)).not.toMatch(/judge/);
    expect(followUp.meta.contextTurns).toBe(1);
    // The earlier turn reached the model as plain text without its old citation handles,
    // and every citation in the new answer was retrieved again in this run.
    const sent = double.requests.slice(before).map((r) => JSON.stringify(r.body.messages)).join("\n");
    expect(sent).toContain("Which action from the kickoff still has no issue?");
    const block = sent.match(/Earlier in this conversation[^"]*/)?.[0] ?? "";
    expect(block).toContain("[sources: Kickoff, 24 November 2026 › Actions");
    expect(block).not.toMatch(/\bS\d+\b/);
    expect(Object.values(followUp.answer.citations).map((c) => (c as { target: unknown }).target)).toEqual(expect.arrayContaining([
      { kind: "note", path: "meetings/2026-11-24 kickoff.md", headingSlug: "actions", headingText: "Actions" },
      { kind: "issue", key: "NEX-1" },
    ]));

    // A manual change in the workspace shows up in the next follow-up.
    const project = (await api.get("/projects")).body.projects[0];
    await api.post("/issues", { projectId: project.id, title: "Write the judge instructions" });
    const after = await ask("Which of those is already tracked?", 3);
    expect(facts(after)).toMatch(/Will writes the judge instructions.*tracked by NEX-2/);
    expect(facts(after)).toMatch(/Hein builds the calendar view.*tracked by NEX-1/);
    expect(Object.values(after.answer.citations).map((c) => (c as { target: unknown }).target)).toContainEqual({ kind: "issue", key: "NEX-2" });
  });

  it("keeps the one-run rule until the answer is saved, then admits the next question", async () => {
    // Widen the window between the run finishing and its answer being written.
    const { api } = await setup("nexus-test-double", { NEXUS_FAULT_DELAY: "ask:before-answer-save:1500" });
    const conv = (await api.post("/conversations", {})).body;
    expect((await api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" })).status).toBe(202);
    let c = (await api.get(`/conversations/${conv.id}`)).body;
    for (let i = 0; i < 50 && c.activeRun !== null; i++) {
      await new Promise((r) => setTimeout(r, 50));
      c = (await api.get(`/conversations/${conv.id}`)).body;
    }
    expect(c.activeRun).toBeNull(); // the model has finished ...
    expect(c.messages[1].status).toBe("running"); // ... but the answer is not saved yet
    const during = await api.post(`/conversations/${conv.id}/ask`, { question: "Which of those is already tracked?" });
    expect(during.status).toBe(409);
    c = await waitForAnswer(api, conv.id, 1);
    expect((await api.post(`/conversations/${conv.id}/ask`, { question: "Which of those is already tracked?" })).status).toBe(202);
    c = await waitForAnswer(api, conv.id, 2);
    expect(c.messages.map((m: { role: string; status: string }) => `${m.role}:${m.status}`)).toEqual(["user:complete", "assistant:complete", "user:complete", "assistant:complete"]);
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
