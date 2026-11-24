import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyEdits, contextAt, docLines, locate, splice } from "./spans";

const note = "# Kickoff\n\n## Actions\n\n- [ ] Hein builds the calendar view\n- [ ] Will writes the judge instructions\n";

describe("locate", () => {
  it("finds a unique line-aligned span", () => {
    expect(locate(note, "- [ ] Hein builds the calendar view\n", null)).toEqual({ status: "ok", start: 4, length: 1 });
  });
  it("does not match partial lines", () => {
    expect(locate(note, "- [ ] Hein builds the calendar\n", null)).toEqual({ status: "missing" });
  });
  it("uses neighbouring lines to choose between repeats, and reports true ambiguity", () => {
    const doc = "## A\n- [x] Same\n- end A\n## B\n- [x] Same\n- end B\n";
    const ctx = contextAt(docLines(doc), 4, 1);
    expect(locate(doc, "- [x] Same", ctx)).toEqual({ status: "ok", start: 4, length: 1 });
    const twin = "## A\n- [x] Same\n- end\n## A\n- [x] Same\n- end\n";
    expect(locate(twin, "- [x] Same", { lineBefore: "## A", lineAfter: "- end" })).toEqual({ status: "ambiguous", count: 2 });
  });
  it("keeps CRLF line endings when splicing", () => {
    const crlf = note.replace(/\n/g, "\r\n");
    const out = splice(crlf, 4, 1, "- [x] Hein builds the calendar view\n");
    expect(out).toBe(crlf.replace("- [ ] Hein", "- [x] Hein"));
  });
});

describe("applyEdits", () => {
  it("applies non-overlapping edits and reports their final positions and context", () => {
    const r = applyEdits(note, [
      { before: "- [ ] Will writes the judge instructions", after: "- [x] Will writes the judge instructions\n- [ ] Will records the demo" },
      { before: "- [ ] Hein builds the calendar view", after: "- [x] Hein builds the calendar view" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("# Kickoff\n\n## Actions\n\n- [x] Hein builds the calendar view\n- [x] Will writes the judge instructions\n- [ ] Will records the demo\n");
    expect(r.placed[1]).toMatchObject({ start: 4, length: 1, context: { lineBefore: "## Actions" } });
    expect(r.placed[0]).toMatchObject({ start: 5, length: 2 });
  });
  it("refuses overlapping or ambiguous edits", () => {
    expect(applyEdits(note, [{ before: "## Actions\n\n- [ ] Hein builds the calendar view", after: "x" }, { before: "- [ ] Hein builds the calendar view", after: "y" }]))
      .toMatchObject({ ok: false, reason: "overlap" });
    expect(applyEdits("a\nb\na\n", [{ before: "a", after: "c" }])).toMatchObject({ ok: false, reason: "ambiguous" });
  });
});

// ---- Property-based checks (design.md "Correctness properties") ----

const lineArb = fc.string({ unit: fc.constantFrom("a", "b", "c", " ", "-", "#", "x"), minLength: 0, maxLength: 6 });
const docArb = fc.array(lineArb, { minLength: 3, maxLength: 12 }).map((ls) => ls.map((l, i) => `${i}:${l}`)); // unique line prefixes

describe("properties", () => {
  it("round trip: applying then reversing a uniquely located span restores the original bytes", () => {
    fc.assert(fc.property(docArb, fc.nat(), fc.string({ maxLength: 20 }), (lines, pick, replacement) => {
      const doc = lines.join("\n") + "\n";
      const target = lines[pick % lines.length]!;
      const after = `NEW ${replacement.replace(/[\r\n]/g, " ")}`;
      const applied = applyEdits(doc, [{ before: target, after }]);
      if (!applied.ok) return false;
      const placed = applied.placed[0]!;
      const found = locate(applied.content, after, placed.context);
      if (found.status !== "ok") return true; // replacement collided with another line: engine would report a conflict, never guess
      return splice(applied.content, found.start, found.length, target) === doc;
    }), { numRuns: 300 });
  });

  it("isolation and unrelated edits: rejecting one change keeps the other change and a manual edit elsewhere", () => {
    fc.assert(fc.property(docArb.filter((l) => l.length >= 4), fc.nat(), fc.nat(), (lines, a, b) => {
      const i = a % lines.length;
      let j = b % lines.length;
      if (j === i) j = (i + 1) % lines.length;
      const doc = lines.join("\n") + "\n";
      const applied = applyEdits(doc, [{ before: lines[i]!, after: `CHANGE-A ${i}` }, { before: lines[j]!, after: `CHANGE-B ${j}` }]);
      if (!applied.ok) return false;
      // A manual edit to a line that is neither change.
      const others = docLines(applied.content).map((l, n) => ({ l, n })).filter(({ l }) => l !== "" && !l.startsWith("CHANGE-"));
      let edited = applied.content;
      if (others.length > 0) edited = splice(edited, others[0]!.n, 1, `${others[0]!.l} (edited by hand)`);
      const loc = locate(edited, `CHANGE-A ${i}`, applied.placed[0]!.context);
      if (loc.status !== "ok") return false;
      const reverted = splice(edited, loc.start, loc.length, lines[i]!);
      const out = docLines(reverted);
      return out.includes(lines[i]!) && out.includes(`CHANGE-B ${j}`) && (others.length === 0 || out.includes(`${others[0]!.l} (edited by hand)`));
    }), { numRuns: 300 });
  });
});
