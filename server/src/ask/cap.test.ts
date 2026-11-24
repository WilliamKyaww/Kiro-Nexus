// R4-11 (Codex review of run 4): with two accepted issues and NEXUS_ASK_ISSUE_CAP=1, the
// retrieval-first coordinator read both and reported 2 of 2. The cap now bounds what is read,
// and coverage counts exactly the records included.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startProviderDouble, type ProviderDouble } from "../../../tools/provider-double/server.mjs";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { runAsk } from "./coordinator";
import { readOnlyWorkspace } from "./workspace";

let double: ProviderDouble;
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;
const profile = () => ({
  id: "prf_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", name: "Test double", baseUrl: double.baseUrl, model: "nexus-test-double-structured", createdAt: "",
  capabilities: { toolCalling: "no" as const, structuredOutput: "yes" as const, testedAt: null, detail: null, fixture: true },
});
const ask = (issueCap: number) => runAsk({
  workspace: readOnlyWorkspace(service, index, engine), question: "Which action from the kickoff still has no issue?", profile: profile(), key: "nexus-fake-cap-key",
  receivingHost: `127.0.0.1:${double.port}`, limits: { issueCap },
});
const sentIssues = (from: number) => {
  const body = double.requests.slice(from).map((r) => JSON.stringify(r.body)).join("");
  return (body.match(/\\"key\\":\\"NEX-\d+\\"/g) ?? []).length;
};

beforeAll(async () => { double = await startProviderDouble(); });
afterAll(async () => { await double.close(); });
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-cap-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `cap-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
  await service.createIssue({ projectId: service.listProjects()[0]!.id, title: "Book venue lighting" }); // two accepted issues
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("the retrieval-first issue cap", () => {
  it.each([
    [0, 0, /issue records from NEX \(0 of 2 read\)/],
    [1, 1, /issue records from NEX \(1 of 2 read\)/],
    [51, 2, /issue records from NEX \(2 of 2 read\)/],
  ])("with a cap of %i, sends and counts %i records", async (cap, read, scope) => {
    const from = double.requests.length;
    const r = await ask(cap);
    expect(r.mode).toBe("retrieval-first");
    expect(r.consulted.issueIdsSeen.size).toBe(read);
    expect(sentIssues(from)).toBe(read);
    expect(r.scopeNote).toMatch(scope);
    if (read < 2) {
      expect(r.scopeNote).toMatch(/Scope limited: only \d of 2 issues were read/);
      expect(r.answer.facts.map((f) => f.text).join("\n")).not.toMatch(/has no matching issue/);
    }
  });
});
