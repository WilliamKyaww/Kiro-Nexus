// R6 repairs: regression tests for R6-9 of the independent run-6 review (reviewer: Astra 6.2 in
// the Codex extension, run by Will). The raw lines a read registers as editable are exactly the
// lines it returns to the model, and a line too long for one read is shown cut short and cannot
// be edited. Fictional data on a disposable copy of the sample workspace.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchIndex } from "../notes/search";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { toProposedOperations } from "./edit";
import { HandleRegistry } from "./handles";
import { READ_PART_CHARS, makeAskTools, newConsulted, readKey } from "./tools";
import { readOnlyWorkspace } from "./workspace";

const PLAN = "plans/week plan.md";
const LONG = `Long line: ${"fictional sample text ".repeat(340).trim()}`;
let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let index: SearchIndex;
let n = 0;
const source = { kind: "agent" as const, label: "Edit by nexus-test-double (test double, not AI)" };
type Part = {
  text: string; truncated: boolean; nextFromLine?: number; headingText: string | null;
  editable?: { fromLine: number; lineCount: number; text: string } | null; notEditable?: string;
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-r69-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `r69-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
});
afterEach(async () => { index?.dispose(); await service.close(); await rm(base, { recursive: true, force: true }); });

async function tools() {
  index?.dispose();
  index = await SearchIndex.build(service);
  const wsr = readOnlyWorkspace(service, index, engine);
  const consulted = newConsulted();
  return { wsr, consulted, tools: makeAskTools(wsr, new HandleRegistry(), consulted) };
}

/** Read every part of a section, as a model that follows nextFromLine does. */
async function readAll(t: Awaited<ReturnType<typeof tools>>, headingSlug: string | null) {
  const parts: Part[] = [];
  let from: number | undefined = 0;
  while (from !== undefined) {
    const part = await t.tools.read_note_section({ path: PLAN, headingSlug, fromLine: from }) as Part;
    parts.push(part);
    from = part.nextFromLine;
  }
  return parts;
}

describe("R6-9: the lines registered as read are the lines the model was shown", () => {
  it("a formatted level-three heading: the raw heading line and its blank lines are returned with the part that registers them (the reviewer's case)", async () => {
    expect(LONG.length).toBeGreaterThan(6500);
    await service.createNote(PLAN, `# Week plan\n\n### **Monday**\n\n${LONG}\n- [ ] Book the hall\n\n## Tuesday\n\n- Rest\n`);
    const t = await tools();
    const parts = await readAll(t, "monday");
    expect(parts.length).toBeGreaterThan(1);
    // Part 0: the heading line with its markup, as it is on disk.
    expect(parts[0]!.headingText).toBe("Monday");
    expect(parts[0]!.editable?.text).toBe("### **Monday**\n");
    // Every registered part is returned to the model line for line, nothing more and nothing less.
    for (const part of parts.filter((p) => p.editable)) {
      const registered = t.consulted.reads.get(readKey(PLAN, "monday", part.editable!.fromLine))!;
      expect(registered).toMatchObject({ from: part.editable!.fromLine, count: part.editable!.lineCount, text: part.editable!.text });
      expect(part.editable!.text.length).toBeLessThanOrEqual(READ_PART_CHARS);
    }
    // Nothing returned is over the bound.
    for (const part of parts) expect(part.text.length).toBeLessThanOrEqual(READ_PART_CHARS);
  });

  it("a single line longer than one read is shown cut short, marked as not editable, and an edit to it is refused with the reason", async () => {
    await service.createNote(PLAN, `# Week plan\n\n## Monday\n\n- [ ] Book the hall\n${LONG}\n- [ ] Order chairs\n`);
    const t = await tools();
    const parts = await readAll(t, "monday");
    const long = parts.find((p) => p.text.startsWith("Long line:"))!;
    expect(long).toBeDefined();
    expect(long.text.length).toBeLessThanOrEqual(READ_PART_CHARS);
    expect(long.editable).toBeNull();
    expect(long.notEditable).toMatch(/cannot be edited/);
    // The full line, or the part of it that was shown, cannot be edited.
    for (const before of [LONG, long.text.replace(/…$/, "")]) {
      const refused = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "monday", before, after: "Short line." }], t.wsr, `r69-${++n}`, t.consulted.reads);
      expect(refused).toMatchObject({ error: expect.stringMatching(/too long to edit/) });
    }
    // The short lines around it can be.
    const mapped = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "monday", before: "- [ ] Order chairs", after: "- [x] Order chairs" }], t.wsr, "r69-ok", t.consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    await engine.propose(source, mapped.operations, "agent");
    expect(await readFile(join(ws, "plans", "week plan.md"), "utf8")).toContain("- [x] Order chairs\n");
  });

  it("indentation and trailing spaces in the registered range are shown, and a line used exactly as shown can be edited", async () => {
    await service.createNote(PLAN, "# Week plan\n\n## Monday\n\n  - [ ] Pack the banner\n- [ ] Book the hall  \n\n## Tuesday\n\n- Rest\n");
    const t = await tools();
    const part = await t.tools.read_note_section({ path: PLAN, headingSlug: "monday" }) as Part;
    expect(part.editable?.text).toBe("## Monday\n\n  - [ ] Pack the banner\n- [ ] Book the hall  \n");
    // Each line of the display text is a raw line of the registered range.
    const raw = part.editable!.text.split("\n");
    for (const line of part.text.split("\n")) expect(raw).toContain(line);
    const first = part.text.split("\n")[0]!;
    expect(first).toBe("  - [ ] Pack the banner");
    const mapped = await toProposedOperations([{ op: "edit_note", note: PLAN, heading: "monday", before: first, after: "  - [x] Pack the banner" }], t.wsr, "r69-ws", t.consulted.reads);
    if ("error" in mapped) throw new Error(mapped.error);
    await engine.propose(source, mapped.operations, "agent");
    expect(await readFile(join(ws, "plans", "week plan.md"), "utf8")).toContain("\n  - [x] Pack the banner\n- [ ] Book the hall  \n");
  });

  it("a whole-note read returns its raw lines too", async () => {
    await service.createNote(PLAN, "# Week plan\n\nFictional sample data.\n\n## Monday\n\n- [ ] Book the hall\n");
    const t = await tools();
    const parts = await readAll(t, null);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.editable?.text).toBe("# Week plan\n\nFictional sample data.\n\n## Monday\n\n- [ ] Book the hall\n");
    expect(t.consulted.reads.get(readKey(PLAN, null, 0))?.text).toBe(parts[0]!.editable!.text);
  });
});
