// Backlinks from the files (.kiro/specs/backlinks-completion, requirement 2). A disposable copy
// of the fictional sample, with fictional notes added on disk.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { backlinksTo } from "./backlinks";

const KICKOFF = "meetings/2026-11-24 kickoff.md";
let base: string;
let ws: string;
let service: WorkspaceService;
const put = async (rel: string, text: string) => {
  await mkdir(join(ws, ...rel.split("/").slice(0, -1)), { recursive: true });
  await writeFile(join(ws, ...rel.split("/")), text);
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-backlinks-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: "backlinks", port: null, startedAt: new Date().toISOString() } });
});
afterEach(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });

describe("backlinks to a note", () => {
  it("lists each link with its section and line, says when a heading is missing, and ignores code", async () => {
    await put("planning/demo script.md", [
      "# Demo script",
      "Start from the kickoff.",
      "## Steps",
      "- [ ] Open [[2026-11-24 kickoff#Actions|the kickoff actions]] and tick one.",
      "- Then the decisions in [[2026-11-24 KICKOFF#Decisions]].",
      "## Later",
      "Read [[2026-11-24 kickoff#Next steps]] once it exists.",
      "`[[2026-11-24 kickoff]]` is how a link is written.",
      "```",
      "[[2026-11-24 kickoff]]",
      "```",
    ].join("\n"));
    await put("ideas/unrelated.md", "Nothing links from here, except [[Demo script]].\n");
    const links = await backlinksTo(service, KICKOFF);
    expect(links.map((l) => [l.source, l.line, l.sectionText, l.heading, l.headingStatus, l.headingSlug])).toEqual([
      ["planning/demo script.md", 3, "Steps", "Actions", "ok", "actions"],
      ["planning/demo script.md", 4, "Steps", "Decisions", "ok", "decisions"],
      ["planning/demo script.md", 6, "Later", "Next steps", "missing", null],
    ]);
    expect(links[0]).toMatchObject({ context: "Open the kickoff actions and tick one.", alias: "the kickoff actions", sectionSlug: "steps", candidates: [] });
    expect(links[1]!.context).toBe("Then the decisions in 2026-11-24 KICKOFF › Decisions.");
    expect(await backlinksTo(service, "planning/demo script.md")).toEqual([expect.objectContaining({ source: "ideas/unrelated.md", line: 0, sectionText: null, headingStatus: "none" })]);
    expect(await backlinksTo(service, "ideas/unrelated.md")).toEqual([]);
  });

  it("lists an ambiguous name on every note it could mean, and a closer note takes the link", async () => {
    await put("meetings/notes.md", "# Meeting notes\n");
    await put("planning/notes.md", "# Planning notes\n");
    await put("ideas/graph.md", "See [[notes]] for both.\n");
    await put("planning/plan.md", "Our [[notes]] are here.\n");
    const meetings = await backlinksTo(service, "meetings/notes.md");
    const planning = await backlinksTo(service, "planning/notes.md");
    expect(meetings).toEqual([expect.objectContaining({ source: "ideas/graph.md", candidates: ["meetings/notes.md", "planning/notes.md"] })]);
    expect(planning.map((l) => [l.source, l.candidates])).toEqual([
      ["ideas/graph.md", ["meetings/notes.md", "planning/notes.md"]],
      ["planning/plan.md", []],
    ]);
  });

  it("finds no backlink in indented code, which the preview shows as code (R6-16)", async () => {
    await put("Target.md", "# Target\n");
    await put("Source.md", ["# Source", "", "See [[Target]] for the plan.", "", "    [[Target]] is how a link is written.", ""].join("\n"));
    expect((await backlinksTo(service, "Target.md")).map((l) => [l.source, l.line, l.raw])).toEqual([["Source.md", 2, "[[Target]]"]]);
  });

  it("resolves a repeated heading's own slug to that heading, and its text to the first (R6-14)", async () => {
    await put("Target.md", ["# Target", "", "## Tasks", "", "Order lunch.", "", "## Tasks", "", "Deliver parcels.", ""].join("\n"));
    await put("Source.md", "First [[Target#Tasks]], second [[Target#tasks-1]], none [[Target#tasks-2]].\n");
    expect((await backlinksTo(service, "Target.md")).map((l) => [l.heading, l.headingStatus, l.headingSlug])).toEqual([
      ["Tasks", "ok", "tasks"],
      ["tasks-1", "ok", "tasks-1"],
      ["tasks-2", "missing", null],
    ]);
  });

  it("follows the files: an edit outside Nexus and a deleted source are seen at once", async () => {
    await put("planning/demo script.md", "Open [[2026-11-24 kickoff]].\n");
    expect(await backlinksTo(service, KICKOFF)).toHaveLength(1);
    await put("planning/demo script.md", "No link any more.\n");
    expect(await backlinksTo(service, KICKOFF)).toEqual([]);
    await expect(backlinksTo(service, "nowhere.md")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
