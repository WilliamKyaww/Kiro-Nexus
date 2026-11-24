// B2 slice: section search and external-change detection on a copy of the sample.
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FSWatcher } from "chokidar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssuesFile, serialise } from "@nexus/schema";
import { WorkspaceService, copySampleWorkspace, type ChangeEvent } from "../workspace/service";
import { SearchIndex } from "./search";
import { startWatcher } from "./watcher";

let base: string;
let ws: string;
let service: WorkspaceService;
let index: SearchIndex;
let watcher: FSWatcher | null = null;
const events: ChangeEvent[] = [];
const NOTE = "meetings/2026-11-24 kickoff.md";

async function waitFor<T>(fn: () => T | undefined | false, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`condition not met within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-notes-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `n-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  events.length = 0;
  service.events.on("change", (e: ChangeEvent) => events.push(e));
});
afterEach(async () => {
  await watcher?.close();
  watcher = null;
  index.dispose();
  await service.close();
  await rm(base, { recursive: true, force: true });
});

describe("section search", () => {
  it("returns the heading section with its path and a snippet, heading matches first", async () => {
    await service.createNote("plans/demo.md", "# Demo plan\n\nThe judge instructions mention the calendar.\n\n## Calendar\n\nMonth view.\n");
    const results = index.search("calendar");
    expect(results[0]).toMatchObject({ path: "plans/demo.md", headingSlug: "calendar", headingPath: ["Demo plan", "Calendar"] });
    const judge = index.search("judge");
    expect(judge.map((r) => `${r.path}#${r.headingSlug}`)).toContain(`${NOTE}#actions`);
    expect(judge.find((r) => r.path === NOTE)?.snippet).toContain("Will writes the judge instructions");
    expect(index.search("judg")[0]).toBeDefined(); // prefix
    expect(index.search("calender").length).toBeGreaterThan(0); // small typo
  });

  it("reflects saves made in Nexus straight away", async () => {
    const note = await service.readNote(NOTE);
    await service.saveNote(NOTE, note.content + "\n## Retrospective\n\nAubergine planning.\n", note.revision);
    await waitFor(() => index.search("aubergine")[0]);
    expect(index.search("aubergine")[0]).toMatchObject({ path: NOTE, headingSlug: "retrospective" });
  });
});

describe("external changes", () => {
  it("reports an outside edit within 2 s, updates search, and ignores Nexus's own writes", async () => {
    watcher = await startWatcher(service, () => undefined);
    const note = await service.readNote(NOTE);
    await service.saveNote(NOTE, note.content + "\nOwn write.\n", note.revision);
    await new Promise((r) => setTimeout(r, 600));
    expect(events.filter((e) => e.source === "external")).toEqual([]);

    const started = Date.now();
    await writeFile(join(ws, ...NOTE.split("/")), (await readFile(join(ws, ...NOTE.split("/")), "utf8")) + "\n## Edited in VS Code\n\nQuokka.\n");
    const ext = await waitFor(() => events.find((e) => e.source === "external" && e.path === NOTE));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(ext.revision).toMatch(/^sha256:/);
    await waitFor(() => index.search("quokka")[0]);
  });

  it("reports a deletion and drops it from search", async () => {
    watcher = await startWatcher(service, () => undefined);
    await unlink(join(ws, ...NOTE.split("/")));
    await waitFor(() => events.find((e) => e.source === "external" && e.path === NOTE && e.revision === null));
    await waitFor(() => index.search("judge").every((r) => r.path !== NOTE));
  });

  it("reloads issues.json edited outside Nexus, and keeps the last good copy if it is invalid", async () => {
    watcher = await startWatcher(service, () => undefined);
    const file = join(ws, ".nexus", "issues.json");
    const data = IssuesFile.parse(JSON.parse(await readFile(file, "utf8")));
    data.issues[0]!.title = "Renamed in a text editor";
    await writeFile(file, serialise(IssuesFile, data));
    await waitFor(() => events.find((e) => e.source === "external" && e.path === ".nexus/issues.json"));
    expect((await service.getIssue("NEX-1")).title).toBe("Renamed in a text editor");

    await writeFile(file, "{ broken");
    await new Promise((r) => setTimeout(r, 700));
    expect((await service.getIssue("NEX-1")).title).toBe("Renamed in a text editor");
    await expect(service.updateIssue("NEX-1", 1, { title: "x" })).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await readFile(file, "utf8")).toBe("{ broken");
  });
});
