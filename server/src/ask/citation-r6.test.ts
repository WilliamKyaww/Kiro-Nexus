// R6-10 (Astra 6.2's review of run 6): a citation of "Tasks", whose section begins "Status" then
// "Deliver parcels.", opened an earlier "Tasks" section inserted later that begins "Status" then
// "Order lunch.", without saying it was unsure. Reproduced with the production read tool (which
// records the excerpt), the review journal's heading aliases and the resolver the note page uses,
// in a copy of the fictional sample.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHeadings } from "@nexus/markdown";
import { checkCitedSection, resolveHeadingParam } from "../../../apps/web/src/notes/headings";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { HandleRegistry, excerptOf } from "./handles";
import { makeAskTools, newConsulted } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const PLAN = "plans/day plan.md";
let base: string;
let ws: string;
let service: WorkspaceService;
let index: SearchIndex | null = null;
let engine: ReviewEngine;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-citation-r6-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `citation-r6-${Date.now()}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index?.dispose(); index = null; await service.close(); await rm(base, { recursive: true, force: true }); });

describe("R6-10: a citation opens the section it read, or says it cannot tell", () => {
  it("opens the cited section after an earlier one with the same name and first line is inserted (the reviewer's case)", async () => {
    await service.createNote(PLAN, "# Day\n\n## Tasks\n\nStatus\nDeliver parcels.\n");
    index = await SearchIndex.build(service);
    const handles = new HandleRegistry();
    const tools = makeAskTools(readOnlyWorkspace(service, index, engine), handles, newConsulted());
    const read = (await tools.read_note_section({ path: PLAN, headingSlug: "tasks" })) as { handle: string };
    const target = handles.get(read.handle)!.target;
    if (target.kind !== "note") throw new Error("expected a note citation");
    const answeredAt = new Date().toISOString();
    // "Status" alone is a label that any section may start with, so the next line is kept too.
    expect(target).toMatchObject({ headingSlug: "tasks", excerpt: "Status\nDeliver parcels." });

    // Later, an earlier "Tasks" section that also starts with "Status" is added outside Nexus.
    const disk = "# Day\n\n## Tasks\n\nStatus\nOrder lunch.\n\n## Tasks\n\nStatus\nDeliver parcels.\n";
    await writeFile(join(ws, "plans", "day plan.md"), disk, "utf8");
    const open = (excerpt: string | null) => {
      const headings = parseHeadings(disk);
      const r = resolveHeadingParam(target.headingSlug!, headings.map((h) => h.slug), engine.headingAliases(PLAN, disk), { ref: "accepted", at: answeredAt });
      return checkCitedSection(disk, headings, r!.slug, excerpt);
    };
    expect(open(target.excerpt ?? null)).toEqual({ slug: "tasks-1", moved: true, uncertain: false });
    // A citation saved before the repair keeps its one line, which both sections hold: the
    // note page now says that it cannot tell which section was cited.
    expect(open("Status")).toEqual({ slug: "tasks", moved: false, uncertain: true });
  });

  it("keeps a one-line excerpt when the line is distinctive, and at most three lines otherwise", () => {
    expect(excerptOf("Deliver parcels.\n- Collect keys")).toBe("Deliver parcels.");
    expect(excerptOf("- [ ] Hein builds the calendar view\n- [ ] Will writes the judge instructions")).toBe("- [ ] Hein builds the calendar view");
    expect(excerptOf("### Sub\n\nStatus\n\nDeliver parcels.\nCollect keys.")).toBe("Status\nDeliver parcels.");
    expect(excerptOf("Status\nTBC\n---\nOK\nDeliver parcels.")).toBe("Status\nTBC\n---");
    expect(excerptOf(`${"x".repeat(150)}\nmore`)).toBe("x".repeat(120));
    expect(excerptOf("\n\n## Only a heading\n")).toBeNull();
  });
});
