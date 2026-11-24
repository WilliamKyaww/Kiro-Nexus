// Requirement 10: Ask search, section reads and heading links during a pending heading rename,
// and after its acceptance or rejection. Reproduced by Codex on 4093fa1: with "Approved heading"
// renamed to "Pending preview" and awaiting review, Ask could not find the accepted heading,
// returned the proposed one without a pending label, and reading that result failed with
// "heading not found".
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHeadings, sections } from "@nexus/markdown";
import { resolveHeadingParam } from "../../../apps/web/src/notes/headings";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { HandleRegistry } from "./handles";
import { makeAskTools, newConsulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const NOTE = "plans/review plan.md";
const CONTENT = "# Review plan\n\nFictional sample data.\n\n## Approved heading\n\n- [ ] Priya checks the preview copy\n\n## Later\n\nNothing yet.\n";
let base: string;
let service: WorkspaceService;
let index: SearchIndex;
let engine: ReviewEngine;
let changeId: string;

const tools = () => makeAskTools(readOnlyWorkspace(service, index, engine), new HandleRegistry(), newConsulted());
const aliases = async (path = NOTE) => engine.headingAliases(path, (await service.readNoteRaw(path))?.content ?? null);
const waitFor = async <T>(fn: () => T | undefined, ms = 3000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-rename-"));
  const ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `rename-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  index = await SearchIndex.build(service);
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
  const created = await service.createNote(NOTE, CONTENT);
  const outcome = await engine.propose({ kind: "fixed-demo", label: "Test rename (fixed, not AI)" }, [
    { opId: "rename-1", kind: "note.replaceSpan", file: NOTE, baseRevision: created.revision, before: "## Approved heading\n", after: "## Pending preview\n" },
  ], "demo");
  changeId = outcome.changes[0]!.changeId;
  await waitFor(() => index.search("Pending preview").find((r) => r.path === NOTE)); // the index follows the disk
});
afterEach(async () => { index.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

describe("while the rename is pending", () => {
  it("finds the accepted heading and labels the proposed one as pending", async () => {
    const t = tools();
    for (const query of ["Approved heading", "Pending preview", "Priya preview copy"]) {
      const hit = (await t.search_notes({ query })).results.find((r) => r.path === NOTE);
      expect(hit, query).toMatchObject({
        headingSlug: "approved-heading", headingPath: ["Review plan", "Approved heading"],
        pendingHeading: "Pending preview",
        pendingReview: [{ proposed: "## Pending preview", replaces: "## Approved heading" }],
      });
      expect(hit!.snippet).toContain("Priya checks the preview copy");
    }
    // The UI's own search still shows the file as it is on disk.
    expect(index.search("Pending preview").find((r) => r.path === NOTE)?.headingSlug).toBe("pending-preview");
  });

  it("reads the section by the search result's slug, or by the proposed slug", async () => {
    const t = tools();
    const hit = (await t.search_notes({ query: "Approved heading" })).results.find((r) => r.path === NOTE)!;
    expect(await t.read_note_section({ path: NOTE, headingSlug: hit.headingSlug })).toMatchObject({
      headingSlug: "approved-heading", headingText: "Approved heading", pendingHeading: "Pending preview",
      text: expect.stringContaining("Priya checks the preview copy"),
    });
    expect(await t.read_note_section({ path: NOTE, headingSlug: "pending-preview" })).toMatchObject({
      headingSlug: "approved-heading", requestedHeading: "pending-preview", resolvedNote: expect.stringMatching(/awaiting review/),
    });
  });

  it("maps the accepted slug to the heading on disk for a citation", async () => {
    expect(await aliases()).toEqual([{ slug: "approved-heading", to: "pending-preview", toText: "Pending preview", reason: "pending-rename", ref: "accepted", at: null }]);
  });
});

// R4-8 (Codex review of run 4, reproduced with the read tool, the journal and the page resolver):
// renaming an earlier heading to the name of a later one made Ask and the note page open
// different sections, and a rename plus an inserted heading in one edit made the renamed
// heading unreadable. Headings are now aligned across the whole document.
describe("document-wide heading identity", () => {
  const WEEK = "plans/week.md";
  const week = "# Week notes\n\nFictional sample data.\n\n## Alpha\n\n- Priya checks the preview copy\n\n## Beta\n\nNothing yet.\n";
  /** The section text the note page would show for a citation, through the real resolver. */
  const pageText = async (slug: string, at: string) => {
    const raw = (await service.readNoteRaw(WEEK))!;
    const target = resolveHeadingParam(slug, parseHeadings(raw.content).map((h) => h.slug), await aliases(WEEK), { ref: "accepted", at });
    return target ? sections(raw.content).find((s) => s.headingSlug === target.slug)?.text ?? null : null;
  };
  const propose = async (before: string, after: string) => {
    const note = (await service.readNoteRaw(WEEK)) ?? (await service.createNote(WEEK, week));
    return (await engine.propose({ kind: "fixed-demo", label: "Test (fixed, not AI)" }, [{ opId: `w-${Date.now()}`, kind: "note.replaceSpan", file: WEEK, baseRevision: note.revision, before, after }], "demo")).changes[0]!.changeId;
  };

  it("a heading renamed to the name of a later one: Ask and the note page open the same section in every state", async () => {
    await service.createNote(WEEK, week);
    const id = await propose("## Alpha\n", "## Beta\n");
    const t = tools();
    const later = await t.read_note_section({ path: WEEK, headingSlug: "beta" });
    expect(later).toMatchObject({ headingSlug: "beta", text: "Nothing yet." });
    const answeredAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    expect(await pageText("beta", answeredAt)).toBe("Nothing yet.");          // pending
    expect(await pageText("alpha", answeredAt)).toBe("- Priya checks the preview copy");
    await engine.accept(id);
    expect(await pageText("beta", answeredAt)).toBe("Nothing yet.");          // accepted
    expect(await pageText("alpha", answeredAt)).toBe("- Priya checks the preview copy");
    // A citation from after the acceptance names the new accepted headings directly.
    const now = new Date().toISOString();
    expect(await pageText("beta-1", now)).toBe("Nothing yet.");
  });

  it("the same citations after the rename is rejected", async () => {
    await service.createNote(WEEK, week);
    const id = await propose("## Alpha\n", "## Beta\n");
    const answeredAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await engine.reject(id);
    expect(await pageText("beta", answeredAt)).toBe("Nothing yet.");
    expect(await pageText("alpha", answeredAt)).toBe("- Priya checks the preview copy");
  });

  it("a rename and an inserted heading in one edit: the renamed heading reads as its accepted section", async () => {
    await service.createNote(WEEK, week);
    const id = await propose("## Alpha\n\n- Priya checks the preview copy\n", "## Preview\n\n- Priya checks the preview copy\n\n## Extra\n\n- Tomasz adds a line\n");
    await waitFor(() => index.search("Tomasz adds a line").find((r) => r.path === WEEK));
    const t = tools();
    expect(await t.read_note_section({ path: WEEK, headingSlug: "preview" })).toMatchObject({ headingSlug: "alpha", text: "- Priya checks the preview copy" });
    expect(await t.read_note_section({ path: WEEK, headingSlug: "extra" })).toMatchObject({ error: "heading not found", note: expect.stringMatching(/would add/) });
    const hit = (await t.search_notes({ query: "Priya preview copy" })).results.find((r) => r.path === WEEK);
    expect(hit).toMatchObject({ headingSlug: "alpha" });
    const answeredAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    expect(await pageText("alpha", answeredAt)).toBe("- Priya checks the preview copy");
    expect(await pageText("beta", answeredAt)).toBe("Nothing yet.");
    await engine.accept(id);
    expect(await pageText("alpha", answeredAt)).toBe("- Priya checks the preview copy");
  });
});

describe("after a decision", () => {
  it("after acceptance, the new heading is the accepted one, and the old slug still leads to it", async () => {
    await engine.accept(changeId);
    const t = tools();
    const hit = (await t.search_notes({ query: "Pending preview" })).results.find((r) => r.path === NOTE);
    expect(hit).toMatchObject({ headingSlug: "pending-preview" });
    expect(hit).not.toHaveProperty("pendingHeading");
    expect(await t.read_note_section({ path: NOTE, headingSlug: "pending-preview" })).toMatchObject({ headingText: "Pending preview", pendingReview: [] });
    expect(await aliases()).toEqual([{ slug: "approved-heading", to: "pending-preview", toText: "Pending preview", reason: "renamed", ref: "accepted", at: expect.any(String) }]);
  });

  it("after rejection, the original heading is back on disk, and the proposed slug leads to it", async () => {
    await engine.reject(changeId);
    await waitFor(() => index.search("Approved heading").find((r) => r.path === NOTE && r.headingSlug === "approved-heading"));
    const t = tools();
    const hit = (await t.search_notes({ query: "Approved heading" })).results.find((r) => r.path === NOTE);
    expect(hit).toMatchObject({ headingSlug: "approved-heading" });
    expect(hit).not.toHaveProperty("pendingHeading");
    expect(await t.read_note_section({ path: NOTE, headingSlug: "approved-heading" })).toMatchObject({ headingText: "Approved heading" });
    expect(await aliases()).toEqual([{ slug: "pending-preview", to: "approved-heading", toText: "Approved heading", reason: "rename-rejected", ref: "disk", at: expect.any(String) }]);
  });
});
