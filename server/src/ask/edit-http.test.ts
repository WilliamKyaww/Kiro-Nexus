// R4-6 (Codex review of run 4, found by reading the source): an Edit run captured its
// workspace for reading, but its proposal looked up the engine of whatever workspace was open
// when the proposal arrived. An outstanding Edit is now bound to the workspace it started in.
// Real service process and the deterministic provider double (a labelled fixture, not AI).
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

let double: ProviderDouble;
let base: string;
let svc: RunningService | null = null;
beforeAll(async () => { double = await startProviderDouble(); base = await mkdtemp(join(tmpdir(), "nexus-edit-http-")); });
afterAll(async () => { await svc?.stop(); await double.close(); await rm(base, { recursive: true, force: true }); });
afterEach(async () => { await svc?.stop(); svc = null; });

async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const name of await readdir(d)) {
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (/^\.nexus\/(conversations|lock|state)/.test(rel)) continue;
      if ((await stat(p)).isDirectory()) await walk(p);
      else out[rel] = createHash("sha256").update(await readFile(p)).digest("hex");
    }
  };
  await walk(dir);
  return out;
}

describe("an Edit run stays bound to the workspace it started in", () => {
  it("refuses its proposal, and writes nothing anywhere, when the workspace is switched during the run", async () => {
    const first = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "first"));
    const second = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "second"));
    svc = await startService({ profile: join(base, "profile"), workspace: first, env: { NEXUS_FAULT_DELAY: "ask:before-propose:1500" } });
    const api = client(svc, await openSession(svc));
    const p = (await api.post("/providers", { name: "Test double", baseUrl: double.baseUrl, model: "nexus-test-double" })).body;
    await api.put(`/providers/${p.id}/session-key`, { key: "nexus-fake-edit-http-key" });
    await api.post(`/providers/${p.id}/test`);
    const before = { first: await hashes(first), second: await hashes(second) };

    const conv = (await api.post("/conversations", {})).body;
    // The grounded kickoff answer first (Ask), then the Edit request in the same conversation.
    await api.post(`/conversations/${conv.id}/ask`, { question: "Which action from the kickoff still has no issue?" });
    for (let i = 0; i < 100 && (await api.get(`/conversations/${conv.id}`)).body.messages.some((m: { status: string }) => m.status === "running"); i++) await new Promise((r) => setTimeout(r, 100));
    expect((await api.post(`/conversations/${conv.id}/ask`, { question: "Create the missing issue, link it to its source heading and update the note line.", mode: "edit" })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 400)); // the run is now waiting before its proposal
    expect((await api.post("/workspace/open", { path: second })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2500));

    expect(await hashes(first)).toEqual(before.first);
    expect(await hashes(second)).toEqual(before.second);
    expect((await api.get("/review/changes?state=all")).body.changes).toEqual([]);
    // The answer is saved in the conversation of the first workspace, and says why nothing was written.
    // The first workspace is closed, so its conversation file cannot be written either; the
    // answer is left running there and is marked as interrupted when the workspace reopens.
    expect((await api.post("/workspace/open", { path: first })).status).toBe(200);
    const reopened = (await api.get(`/conversations/${conv.id}`)).body;
    expect(reopened.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed", error: { code: "INTERRUPTED" } });
    expect(reopened.messages.at(-1).edit ?? null).toBeNull();
    expect(await hashes(first)).toEqual(before.first);
  });
});
