// Provider diagnostics never carry a key into the UI, logs, profile files, conversations
// or the live-check report. Reproduced on e61a3d4: a provider that echoed the key in a
// non-fatal probe error had it copied into the profile's `detail`, which was saved to
// providers.json and returned by GET /providers.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { promptHidden } from "../../../scripts/live-ask-check.mjs";
import { client, openSession, startService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";
import { KeyStore } from "./keys";
import { redactSecrets, sanitiseDeep, sanitiseDiagnostic } from "./sanitise.mjs";

// Synthetic sentinel: not a real key, and shaped unlike any provider's keys, so only the
// known-key path can catch it.
const SENTINEL = "nexus-sentinel-K7q2Zp9Lw4Rt8Vx1Hc6";
const FRAGMENT = SENTINEL.slice(0, 16);
let double: ProviderDouble;
let base: string;
beforeAll(async () => { double = await startProviderDouble(); base = await mkdtemp(join(tmpdir(), "nexus-sanitise-")); });
afterAll(async () => { await double.close(); await rm(base, { recursive: true, force: true }); });

async function filesContaining(dir: string, needles: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) hits.push(...await filesContaining(p, needles));
    else {
      const text = await readFile(p, "utf8");
      if (needles.some((n) => text.includes(n))) hits.push(p);
    }
  }
  return hits;
}

describe("sanitising diagnostics", () => {
  it("removes the known key, long fragments of it and key-shaped strings", () => {
    const shaped = ["gsk", "Q".repeat(4) + "w".repeat(20)].join("_"); // built at run time: the secret scan checks files
    const text = `key ${SENTINEL} prefix ${FRAGMENT}… tail ${SENTINEL.slice(-9)} other ${shaped} auth Bearer abcdefghijkl12345 url ?api_key=zzz123&x=1`;
    const out = redactSecrets(text, [SENTINEL]);
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain(FRAGMENT);
    expect(out).not.toContain(SENTINEL.slice(-9));
    expect(out).not.toContain(shaped);
    expect(out).toContain("Bearer [redacted]");
    expect(out).toContain("?api_key=[redacted]&x=1");
    expect(out).toContain("key [redacted key] prefix [redacted key]");
    // Short, common pieces are left alone, so diagnostics stay readable.
    expect(redactSecrets("model nexus-test-double", [SENTINEL])).toBe("model nexus-test-double");
  });

  it("makes a diagnostic a single safe line of bounded length", () => {
    const out = sanitiseDiagnostic(`bad\u001b[31m red\r\nforged log line\u202e ${"x".repeat(500)}`, { keys: [SENTINEL], max: 60 });
    expect(out).not.toMatch(/[\u0000-\u001f\u202e]/);
    expect(out.startsWith("bad red forged log line")).toBe(true);
    expect(out.length).toBe(60);
    expect(sanitiseDeep({ a: [`x ${SENTINEL}`], n: 3 }, { keys: [SENTINEL] })).toEqual({ a: ["x [redacted key]"], n: 3 });
  });

  it("is what the key store applies to logs and provider errors", () => {
    const keys = new KeyStore();
    keys.set("prf_a", SENTINEL, "session");
    expect(keys.redact(`line with ${FRAGMENT}`)).toBe("line with [redacted key]");
    expect(keys.sanitise(`one\ntwo ${SENTINEL}`)).toBe("one two [redacted key]");
  });
});

describe("the live check's masked key prompt", () => {
  const fakeTty = () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, raw: [] as boolean[], setRawMode(on: boolean) { this.raw.push(on); } });
    const output = new PassThrough();
    let shown = "";
    output.on("data", (d) => { shown += d; });
    return { input, output, shown: () => shown };
  };

  it("echoes only asterisks, handles backspace and paste markers, and restores the terminal", async () => {
    const t = fakeTty();
    const answer = promptHidden("Key: ", t.input, t.output);
    t.input.write("\u001b[200~");
    t.input.write("abcx\b");
    t.input.write("d\u001b[201~\r");
    expect(await answer).toBe("abcd");
    expect(t.shown()).toContain("Key: ");
    expect(t.shown()).not.toMatch(/[abcd]{2}/);
    expect(t.input.raw).toEqual([true, false]);
  });

  it("gives up on Ctrl+C and still restores the terminal", async () => {
    const t = fakeTty();
    const answer = promptHidden("Key: ", t.input, t.output);
    t.input.write("abc\u0003");
    expect(await answer).toBeNull();
    expect(t.input.raw).toEqual([true, false]);
  });

  it("does not prompt when there is no terminal", async () => {
    expect(await promptHidden("Key: ", new PassThrough() as never, new PassThrough())).toBeNull();
  });
});

describe("a provider that echoes the key in its errors", () => {
  it("never shows, logs or saves the key or a fragment of it", async () => {
    const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
    const profileDir = join(base, "profile");
    const svc = await startService({ profile: profileDir, workspace: ws });
    let seen = "";
    try {
      const api = client(svc, await openSession(svc));
      const p = (await api.post("/providers", { name: "Echoing provider", baseUrl: double.baseUrl, model: "nexus-test-double-echo" })).body;
      await api.put(`/providers/${p.id}/session-key`, { key: SENTINEL });
      const tested = await api.post(`/providers/${p.id}/test`);
      expect(tested.status).toBe(200);
      expect(tested.body.profile.capabilities).toMatchObject({ toolCalling: "no", structuredOutput: "yes" });
      // The diagnostic is still useful, but the key is gone and control characters are removed.
      expect(tested.body.profile.capabilities.detail).toMatch(/Tools are not enabled for key \[redacted key\]/);
      expect(tested.body.profile.capabilities.detail).not.toMatch(/[\u0000-\u001f]/);
      const listed = await api.get("/providers");
      // A real question in retrieval-first mode fails with an error that echoes a fragment.
      const conv = (await api.post("/conversations", {})).body;
      await api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" });
      let c: { messages: Array<{ role: string; status: string; error: { code: string; message: string } | null }> } = { messages: [] };
      for (let i = 0; i < 100 && !c.messages.some((m) => m.role === "assistant" && m.status !== "running"); i++) {
        await new Promise((r) => setTimeout(r, 100));
        c = (await api.get(`/conversations/${conv.id}`)).body;
      }
      const failed = c.messages.find((m) => m.role === "assistant")!;
      expect(failed).toMatchObject({ status: "failed", error: { code: "PROVIDER_ERROR" } });
      expect(failed.error!.message).toContain("[redacted key]");
      seen = JSON.stringify([tested.body, listed.body, c]);
    } finally {
      await svc.stop();
    }
    expect(seen).not.toContain(SENTINEL);
    expect(seen).not.toContain(FRAGMENT);
    expect(await filesContaining(profileDir, [SENTINEL, FRAGMENT])).toEqual([]); // providers.json and service.log
    expect(await filesContaining(ws, [SENTINEL, FRAGMENT])).toEqual([]); // conversation file
    expect(svc.stderr()).not.toContain(FRAGMENT);
  });

  it("keeps the key out of the live-check report and its console output", async () => {
    const dir = await mkdtemp(join(base, "live-"));
    const child = spawn(process.execPath, ["scripts/live-ask-check.mjs"], {
      env: { ...process.env, NEXUS_LIVE_BASE_URL: double.baseUrl, NEXUS_LIVE_MODEL: "nexus-test-double-echo", NEXUS_LIVE_KEY: SENTINEL, NEXUS_LIVE_OUT_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    const code = await new Promise<number | null>((r) => child.once("exit", r));
    expect(code).toBe(7); // the provider refused the question
    const [file] = await readdir(dir);
    const report = await readFile(join(dir, file!), "utf8");
    expect(report).toContain("[redacted key]");
    expect(report + output).not.toContain(SENTINEL);
    expect(report + output).not.toContain(FRAGMENT);
  });
});
