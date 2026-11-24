import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, serialise } from "@nexus/schema";
import { NexusError } from "../errors";
import { setFaultInjector } from "../faults";
import { atomicWrite, sha256 } from "./atomic";
import { acquireLock, lockPath, releaseLock } from "./lock";
import { resolveNotePath } from "./paths";
import { WorkspaceService, copySampleWorkspace, preserveLineEndings } from "./service";

let dir: string;
const lock = (id = "test-a") => ({ pid: process.pid, instanceId: id, port: null, startedAt: new Date().toISOString() });

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "nexus-ws-")); });
afterEach(async () => { setFaultInjector(null); await rm(dir, { recursive: true, force: true }); });

describe("atomicWrite", () => {
  it("leaves the original intact when the write is interrupted before rename", async () => {
    const file = join(dir, "note.md");
    await writeFile(file, "original");
    setFaultInjector((p) => { if (p === "atomic:before-rename") throw new Error("crash"); });
    await expect(atomicWrite(file, "new content")).rejects.toThrow("crash");
    expect(await readFile(file, "utf8")).toBe("original");
    expect((await readdir(dir)).filter((f) => f.includes("nexus-tmp"))).toEqual([]);
  });

  it("replaces content and hashes consistently", async () => {
    const file = join(dir, "note.md");
    await atomicWrite(file, "hello");
    expect(await readFile(file, "utf8")).toBe("hello");
    expect(sha256(await readFile(file))).toBe(sha256("hello"));
  });
});

describe("resolveNotePath", () => {
  it.each(["../x.md", "/abs.md", "C:/x.md", ".nexus/issues.json", "a/.hidden/x.md", "notes.txt", "a//b.md", "con.md", "bad:name.md"])(
    "rejects %s", (p) => { expect(() => resolveNotePath(dir, p)).toThrow(NexusError); },
  );
  it("normalises backslashes", () => { expect(resolveNotePath(dir, "meetings\\kickoff.md").rel).toBe("meetings/kickoff.md"); });
});

describe("lock", () => {
  it("refuses a live holder and takes over a dead one", async () => {
    await mkdir(join(dir, ".nexus"));
    await acquireLock(dir, lock("one"));
    await expect(acquireLock(dir, lock("two"))).rejects.toMatchObject({ code: "LOCKED" });
    await writeFile(lockPath(dir), JSON.stringify({ ...lock("ghost"), pid: 2_147_483_000 }));
    const result = await acquireLock(dir, lock("two"));
    expect(result.takenOverFrom?.instanceId).toBe("ghost");
    await releaseLock(dir, "two");
    await expect(readFile(lockPath(dir))).rejects.toThrow();
  });
});

describe("WorkspaceService", () => {
  it("initialises .nexus with versioned files", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    for (const f of ["workspace.json", "projects.json", "issues.json"]) {
      expect(JSON.parse(await readFile(join(dir, ".nexus", f), "utf8")).schemaVersion).toBe(1);
    }
    await s.close();
  });

  it("stores notes byte-for-byte and refuses stale saves", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    const content = "# Plan\n\n## Actions\n- [ ] Draft\n";
    const note = await s.createNote("meetings/plan.md", content);
    expect(await readFile(join(dir, "meetings", "plan.md"), "utf8")).toBe(content);
    await expect(s.createNote("meetings/plan.md", "x")).rejects.toMatchObject({ code: "EXISTS" });

    const saved = await s.saveNote("meetings/plan.md", content + "- [ ] More\n", note.revision);
    await expect(s.saveNote("meetings/plan.md", "stale", note.revision)).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(await readFile(join(dir, "meetings", "plan.md"), "utf8")).toBe(content + "- [ ] More\n");
    expect(saved.headings.map((h) => h.slug)).toEqual(["plan", "actions"]);
    await s.close();
  });

  it("creates issues with incrementing keys and links them to headings both ways", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    await s.createNote("plan.md", "# Plan\n## Actions\n");
    const project = await s.createProject("NEX", "Nexus");
    const one = await s.createIssue({ projectId: project.id, title: "First", noteLinks: [{ notePath: "plan.md", headingSlug: "actions", headingText: "Actions" }] });
    const two = await s.createIssue({ projectId: project.id, title: "Second" });
    expect([one.key, two.key]).toEqual(["NEX-1", "NEX-2"]);
    expect(one.links[0]).toMatchObject({ status: "ok", resolvedSlug: "actions" });
    const note = await s.readNote("plan.md");
    expect(note.linkedIssues).toEqual([{ key: "NEX-1", title: "First", status: "todo", headingSlug: "actions", headingText: "Actions", linkStatus: "ok" }]);

    // Heading renamed: slug gone, text gone -> heading-missing; text unique -> resolves.
    await s.saveNote("plan.md", "# Plan\n## Next steps\n", note.revision);
    expect((await s.getIssue("NEX-1")).links[0]?.status).toBe("heading-missing");
    await s.close();
  });

  it("increments revision on update and refuses a stale base revision", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    const p = await s.createProject("NEX", "Nexus");
    const issue = await s.createIssue({ projectId: p.id, title: "Task" });
    const updated = await s.updateIssue("NEX-1", 1, { status: "in_progress", due: { date: "2026-12-03" } });
    expect(updated.revision).toBe(2);
    await expect(s.updateIssue("NEX-1", 1, { title: "Old view" })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    const onDisk = IssuesFile.parse(JSON.parse(await readFile(join(dir, ".nexus", "issues.json"), "utf8")));
    expect(onDisk.issues[0]).toMatchObject({ id: issue.id, status: "in_progress", due: { date: "2026-12-03" }, revision: 2 });
    await s.close();
  });

  it("merges a stale edit field by field: different fields both survive, the same field conflicts", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    const p = await s.createProject("NEX", "Nexus");
    await s.createIssue({ projectId: p.id, title: "Original", description: "Original text" });
    // Tab B saves a new title first (revision 1 -> 2).
    await s.updateIssue("NEX-1", 1, { title: "Title from B" }, { title: "Original" });
    // Tab A started from revision 1 and edited only the description: merged on top.
    const merged = await s.updateIssue("NEX-1", 1, { description: "Description from A" }, { description: "Original text" });
    expect(merged).toMatchObject({ title: "Title from B", description: "Description from A", revision: 3 });
    // Tab C also started from revision 1 and edited the title: a conflict, nothing written.
    await expect(s.updateIssue("NEX-1", 1, { title: "Title from C" }, { title: "Original" }))
      .rejects.toMatchObject({ code: "REVISION_MISMATCH", details: { conflictingFields: ["title"] } });
    // Without base values a stale write is still refused outright.
    await expect(s.updateIssue("NEX-1", 1, { priority: "high" })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    // Choosing "keep mine" re-bases on the current revision.
    const kept = await s.updateIssue("NEX-1", 3, { title: "Title from C" }, { title: "Title from B" });
    expect(kept).toMatchObject({ title: "Title from C", description: "Description from A", revision: 4 });
    const onDisk = JSON.parse(await readFile(join(dir, ".nexus", "issues.json"), "utf8")).issues[0];
    expect(onDisk).toMatchObject({ title: "Title from C", description: "Description from A", revision: 4 });
    await s.close();
  });

  it("refuses to overwrite issues.json changed outside Nexus and reloads it", async () => {
    const s = await WorkspaceService.open(dir, { lock: lock() });
    const p = await s.createProject("NEX", "Nexus");
    await s.createIssue({ projectId: p.id, title: "Task" });
    const file = join(dir, ".nexus", "issues.json");
    const external = IssuesFile.parse(JSON.parse(await readFile(file, "utf8")));
    external.issues[0]!.title = "Edited in another editor";
    await writeFile(file, serialise(IssuesFile, external));
    await expect(s.updateIssue("NEX-1", 1, { title: "Mine" })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect((await s.getIssue("NEX-1")).title).toBe("Edited in another editor");
    expect(JSON.parse(await readFile(file, "utf8")).issues[0].title).toBe("Edited in another editor");
    await s.close();
  });

  it("reports which data file is invalid and does not overwrite it", async () => {
    await mkdir(join(dir, ".nexus"));
    await writeFile(join(dir, ".nexus", "issues.json"), "{ not json");
    await expect(WorkspaceService.open(dir, { lock: lock() })).rejects.toMatchObject({ code: "INVALID_DATA", details: { file: "issues.json" } });
    expect(await readFile(join(dir, ".nexus", "issues.json"), "utf8")).toBe("{ not json");
    await expect(readFile(lockPath(dir))).rejects.toThrow();
  });

  it("copies the sample with a fresh identity and keeps the original untouched", async () => {
    const sample = join(process.cwd(), "samples", "meeting-workspace");
    const before = await readFile(join(sample, ".nexus", "workspace.json"), "utf8");
    const target = await copySampleWorkspace(sample, join(dir, "copy"));
    const s = await WorkspaceService.open(target, { lock: lock() });
    expect(s.manifest.workspaceId).not.toBe(JSON.parse(before).workspaceId);
    expect((await s.getIssue("NEX-1")).links[0]).toMatchObject({ status: "ok", resolvedSlug: "actions" });
    expect(await readFile(join(sample, ".nexus", "workspace.json"), "utf8")).toBe(before);
    await s.close();
    await expect(copySampleWorkspace(sample, target)).rejects.toMatchObject({ code: "EXISTS" });
  });

  it("keeps CRLF files CRLF after a textarea round trip", () => {
    expect(preserveLineEndings("a\r\nb\r\n", "a\nb\nc\n")).toBe("a\r\nb\r\nc\r\n");
    expect(preserveLineEndings("a\nb\n", "a\nb\nc\n")).toBe("a\nb\nc\n");
  });
});
