// Slice C1: profiles, the OpenAI-compatible adapter and capability probes, against the
// deterministic test double (a fixture, not AI). Keys here are fake.
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { client, openSession, startService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";
import { ProviderError, chat } from "./openai";
import { probeProfile } from "./probe";
import { ProviderRegistry, normaliseBaseUrl } from "./profiles";

const FAKE_KEY = "nexus-fake-key-7f3a9c2e1b";
let double: ProviderDouble;
let base: string;
beforeAll(async () => { double = await startProviderDouble(); base = await mkdtemp(join(tmpdir(), "nexus-providers-")); });
afterAll(async () => { await double.close(); await rm(base, { recursive: true, force: true }); });

describe("profiles", () => {
  it("accepts https and local http only, and keeps no key", async () => {
    expect(normaliseBaseUrl("https://api.groq.com/openai/v1/")).toBe("https://api.groq.com/openai/v1");
    expect(normaliseBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
    expect(() => normaliseBaseUrl("http://example.com/v1")).toThrow(/https/);
    expect(() => normaliseBaseUrl("https://user:pw@example.com/v1")).toThrow();
    const reg = await ProviderRegistry.load(join(base, "reg"));
    const a = await reg.add({ name: "A", baseUrl: double.baseUrl, model: "nexus-test-double" });
    const b = await reg.add({ name: "B", baseUrl: double.baseUrl, model: "nexus-test-double-structured" });
    expect(reg.list().selectedId).toBe(a.id);
    await reg.select(b.id);
    await reg.remove(b.id);
    expect(reg.list().selectedId).toBe(a.id);
    const saved = await readFile(join(base, "reg", "providers.json"), "utf8");
    expect(saved).not.toContain("key");
    expect((await ProviderRegistry.load(join(base, "reg"))).list().profiles.map((p) => p.name)).toEqual(["A"]);
  });
});

describe("adapter and probes", () => {
  const profile = (model: string) => ({
    id: "prf_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", name: "Double", baseUrl: double.baseUrl, model, createdAt: "",
    capabilities: { toolCalling: "unknown" as const, structuredOutput: "unknown" as const, testedAt: null, detail: null, fixture: false },
  });

  it("probes tool calling and structured output separately", async () => {
    expect(await probeProfile(profile("nexus-test-double"), FAKE_KEY)).toMatchObject({ toolCalling: "yes", structuredOutput: "yes", fixture: true });
    expect(await probeProfile(profile("nexus-test-double-structured"), FAKE_KEY)).toMatchObject({ toolCalling: "no", structuredOutput: "yes" });
  });

  it("reports invalid credentials, rate limits, timeouts and cancellation distinctly", async () => {
    const call = (model: string, extra: Partial<Parameters<typeof chat>[0]> = {}) =>
      chat({ baseUrl: double.baseUrl, model, key: FAKE_KEY, messages: [{ role: "user", content: "hi" }], ...extra });
    await expect(call("nexus-test-double", { key: "invalid-key" })).rejects.toMatchObject({ kind: "auth" });
    const before = double.requests.length;
    const retries: string[] = [];
    await expect(call("nexus-test-double-429", { onRetry: (w) => retries.push(w) })).rejects.toMatchObject({ kind: "rate_limit", status: 429 });
    expect(double.requests.length - before).toBe(3); // first try plus two retries
    expect(retries[0]).toMatch(/Rate limited/);
    await expect(call("nexus-test-double-slow", { timeoutMs: 300, maxRetries: 0 })).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(call("nexus-test-double-slow", { signal: controller.signal, maxRetries: 0 })).rejects.toBeInstanceOf(ProviderError);
    await expect(call("nexus-test-double-slow", { signal: AbortSignal.abort(), maxRetries: 0 })).rejects.toMatchObject({ kind: "cancelled" });
    await expect(chat({ baseUrl: "http://127.0.0.1:9/v1", model: "x", key: FAKE_KEY, messages: [], maxRetries: 0 })).rejects.toMatchObject({ kind: "network" });
  });
});

describe("provider API in the real service", () => {
  it("adds, tests, selects and removes a profile, and the key never leaves service memory", async () => {
    const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
    const profileDir = join(base, "profile");
    const svc = await startService({ profile: profileDir, workspace: ws });
    try {
      const api = client(svc, await openSession(svc));
      expect((await api.post("/providers", { name: "Remote http", baseUrl: "http://example.com/v1", model: "m" })).status).toBe(400);
      const added = await api.post("/providers", { name: "Test double", baseUrl: double.baseUrl, model: "nexus-test-double" });
      expect(added.status).toBe(201);
      const id = added.body.id;
      expect(added.body).toMatchObject({ hasKey: false, receivingHost: `127.0.0.1:${double.port}` });
      expect((await api.post(`/providers/${id}/test`)).status).toBe(400); // no key yet
      expect((await api.put(`/providers/${id}/session-key`, { key: FAKE_KEY })).body).toMatchObject({ hasKey: true, keyStorage: "session" });
      const tested = await api.post(`/providers/${id}/test`);
      expect(tested.body.profile.capabilities).toMatchObject({ toolCalling: "yes", structuredOutput: "yes", fixture: true });
      expect(JSON.stringify((await api.get("/providers")).body)).not.toContain(FAKE_KEY);

      await api.put(`/providers/${id}/session-key`, { key: "invalid-key" });
      const bad = await api.post(`/providers/${id}/test`);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatchObject({ details: { providerCode: "PROVIDER_AUTH" } });
      expect(bad.body.error.message).toContain("rejected the key");

      await api.put(`/providers/${id}/session-key`, { key: FAKE_KEY });
      expect((await api.del(`/providers/${id}`)).status).toBe(200);
      expect((await api.get("/providers")).body.profiles).toEqual([]);
    } finally {
      await svc.stop();
    }
    // The fake key appears nowhere on disk: profile folder (providers.json, logs) and workspace.
    const scan = async (dir: string): Promise<string[]> => {
      const hits: string[] = [];
      for (const name of await readdir(dir)) {
        const p = join(dir, name);
        if ((await stat(p)).isDirectory()) hits.push(...await scan(p));
        else if ((await readFile(p)).includes(FAKE_KEY)) hits.push(p);
      }
      return hits;
    };
    expect(await scan(profileDir)).toEqual([]);
    expect(await scan(ws)).toEqual([]);
  });
});
