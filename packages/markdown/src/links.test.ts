// The shared wikilink rule (.kiro/specs/backlinks-completion, requirement 1).
import { describe, expect, it } from "vitest";
import { inCodeAt, lineInDraft, linkDisplay, linksIn, noteTargetFor, resolveNoteTarget } from "./links";

const NOTES = ["meetings/2026-11-24 kickoff.md", "meetings/notes.md", "planning/notes.md", "planning/demo script.md", "ideas/graph view.md", "Index.md"];

describe("resolving a link target", () => {
  it("matches the path, then the file name, case-insensitively, with or without .md", () => {
    expect(resolveNoteTarget("meetings/2026-11-24 kickoff", NOTES)).toEqual({ status: "ok", path: "meetings/2026-11-24 kickoff.md" });
    expect(resolveNoteTarget("2026-11-24 KICKOFF", NOTES)).toEqual({ status: "ok", path: "meetings/2026-11-24 kickoff.md" });
    expect(resolveNoteTarget("Demo Script.md", NOTES)).toEqual({ status: "ok", path: "planning/demo script.md" });
    expect(resolveNoteTarget("index", NOTES)).toEqual({ status: "ok", path: "Index.md" });
    expect(resolveNoteTarget("nowhere", NOTES)).toEqual({ status: "missing" });
    expect(resolveNoteTarget("  ", NOTES)).toEqual({ status: "missing" });
  });

  it("prefers the closest note when several share a name, and names the candidates when none is closer", () => {
    expect(resolveNoteTarget("notes", NOTES, "planning/demo script.md")).toEqual({ status: "ok", path: "planning/notes.md" });
    expect(resolveNoteTarget("notes", NOTES, "meetings/2026-11-24 kickoff.md")).toEqual({ status: "ok", path: "meetings/notes.md" });
    expect(resolveNoteTarget("notes", NOTES, "ideas/graph view.md")).toEqual({ status: "ambiguous", candidates: ["meetings/notes.md", "planning/notes.md"] });
    expect(resolveNoteTarget("notes", NOTES)).toEqual({ status: "ambiguous", candidates: ["meetings/notes.md", "planning/notes.md"] });
    // A path, or the end of one, settles it.
    expect(resolveNoteTarget("planning/notes", NOTES, "ideas/graph view.md")).toEqual({ status: "ok", path: "planning/notes.md" });
    // Fewer folders wins when no folder is shared.
    expect(resolveNoteTarget("notes", ["notes.md", "a/b/notes.md"], "x/y.md")).toEqual({ status: "ok", path: "notes.md" });
  });

  it("writes the file name, or the path when another note has the same name", () => {
    expect(noteTargetFor("meetings/2026-11-24 kickoff.md", NOTES)).toBe("2026-11-24 kickoff");
    expect(noteTargetFor("planning/notes.md", NOTES)).toBe("planning/notes");
    for (const p of NOTES) expect(resolveNoteTarget(noteTargetFor(p, NOTES), NOTES, "ideas/graph view.md")).toEqual({ status: "ok", path: p });
  });
});

describe("finding links in a note", () => {
  it("returns the parts and the line of each link, outside code", () => {
    const text = [
      "# Plan",
      "See [[2026-11-24 kickoff#Actions|the actions]] and [[Demo script]].",
      "Inline `[[not a link]]` stays code.",
      "```",
      "[[also code]]",
      "```",
      "- [ ] Ask about [[graph view#Layout]]",
    ].join("\n");
    expect(linksIn(text).map((l) => [l.line, l.target, l.heading, l.alias])).toEqual([
      [1, "2026-11-24 kickoff", "Actions", "the actions"],
      [1, "Demo script", null, null],
      [6, "graph view", "Layout", null],
    ]);
    expect(linksIn(text)[0]).toMatchObject({ column: 4, lineText: "See [[2026-11-24 kickoff#Actions|the actions]] and [[Demo script]].", raw: "[[2026-11-24 kickoff#Actions|the actions]]" });
    expect(linksIn("~~~\n[[x]]\n~~~\n[[y]]").map((l) => l.target)).toEqual(["y"]);
    expect(linksIn("[[a\r\nb]] [[c]]\r\n").map((l) => l.target)).toEqual(["c"]);
  });

  it("shows a line's links as the preview does", () => {
    expect(linkDisplay("See [[kickoff#Actions|the actions]], [[Demo script]] and [[kickoff#Decisions]].")).toBe("See the actions, Demo script and kickoff › Decisions.");
  });
});

// R6-16: the link finder reads the same Markdown contexts as the preview, which renders an
// indented block as code and a link's own text as that link.
describe("links where the preview renders them", () => {
  it("ignores a link in indented code, keeping the lines and columns of the others", () => {
    const text = ["# Plan", "", "See [[Target]] for the plan.", "", "    [[Target]] is how a link is written.", "", "After the code, [[Other]]."].join("\n");
    expect(linksIn(text).map((l) => [l.line, l.column, l.target, l.raw])).toEqual([[2, 4, "Target", "[[Target]]"], [6, 16, "Other", "[[Other]]"]]);
    expect(linksIn("\tTabbed [[Target]] is code too.\n")).toEqual([]);
  });

  it("keeps indented links that are not code: a list item's continuation, a paragraph's next line, a quote", () => {
    expect(linksIn("- Item\n\n    Continued with [[A]].\n").map((l) => [l.line, l.column, l.target])).toEqual([[2, 19, "A"]]);
    expect(linksIn("Para line\n    [[B]] continues it.\n").map((l) => [l.line, l.column, l.target])).toEqual([[1, 4, "B"]]);
    expect(linksIn("> Quoted [[C]]\n> and [[D#Part|alias]]").map((l) => [l.line, l.column, l.target, l.heading, l.alias, l.lineText])).toEqual([
      [0, 9, "C", null, null, "> Quoted [[C]]"],
      [1, 6, "D", "Part", "alias", "> and [[D#Part|alias]]"],
    ]);
  });

  it("follows fences and indented code inside list items and quotes", () => {
    const text = [
      "1. Step",
      "",
      "   ```",
      "   [[In a fence]]",
      "   ```",
      "",
      "       [[Indented code in the item]]",
      "",
      "   Back in the item: [[A]]",
      "",
      "> Quote",
      ">",
      ">     [[Indented code in the quote]]",
      "",
      "[[B]]",
    ].join("\n");
    expect(linksIn(text).map((l) => [l.line, l.target])).toEqual([[8, "A"], [14, "B"]]);
  });

  it("reads a code span across a line break, and a numbered line that cannot start a list", () => {
    expect(linksIn("Run ``the\n[[A]] example`` and [[B]]\n\n\\`[[C]]` is not code.").map((l) => [l.line, l.column, l.target])).toEqual([[1, 20, "B"], [3, 2, "C"]]);
    // "2." cannot interrupt a paragraph, so the next block is not inside a list item.
    expect(linksIn("Para\n2. [[A]]\n\n    [[B]] is code\n").map((l) => l.target)).toEqual(["A"]);
  });

  it("says whether a position is in code", () => {
    const text = "Text `[[a]]` here\n\n```\n[[b\n```\n\n    [[c\n\n[[d";
    const at = (s: string) => text.indexOf(s);
    expect([at("[[a"), at("[[b"), at("[[c"), at("[[d"), at("Text")].map((i) => inCodeAt(text, i))).toEqual([true, true, true, false, false]);
    expect(inCodeAt("```\n[[open fence", 4)).toBe(true);
  });
});

// R6-13: a backlink names a line of the saved file; an unsaved draft may have moved it.
describe("finding a saved link's line in an unsaved draft", () => {
  const SAVED = ["# Script", "", "## Steps", "", "- [ ] Open [[Target|the actions]] and tick one.", "- Show the bar.", ""].join("\n");
  const RAW = "[[Target|the actions]]";
  const lines = SAVED.split("\n");
  const withAbove = [...lines.slice(0, 4), "Wrong draft paragraph.", "", ...lines.slice(4)].join("\n");

  it("follows the link's line when a paragraph is inserted above it", () => {
    expect(lineInDraft(SAVED, SAVED, 4, RAW)).toBe(4);
    expect(lineInDraft(SAVED, withAbove, 4, RAW)).toBe(6);
  });

  it("follows the link when its line was edited but the link itself is still there once", () => {
    const edited = withAbove.replace("and tick one.", "and tick two.");
    expect(lineInDraft(SAVED, edited, 4, RAW)).toBe(6);
  });

  it("tells repeated lines apart by their neighbours, and gives no line when it cannot be sure", () => {
    const twice = ["## Monday", "", "- [ ] Open [[Target]]", "", "## Tuesday", "", "- [ ] Open [[Target]]", ""].join("\n");
    const draft = ["## Monday", "", "Inserted.", "", "- [ ] Open [[Target]]", "", "## Tuesday", "", "- [ ] Open [[Target]]", ""].join("\n");
    expect(lineInDraft(twice, draft, 6, "[[Target]]")).toBe(8);
    // Monday's copy has a new neighbour in the draft, so neither copy is certainly it.
    expect(lineInDraft(twice, draft, 2, "[[Target]]")).toBeNull();
    // Both copies now sit under the same neighbours: no guess.
    const same = ["## Monday", "", "- [ ] Open [[Target]]", "", "- [ ] Open [[Target]]", ""].join("\n");
    expect(lineInDraft(twice, same, 2, "[[Target]]")).toBeNull();
    // The link was changed or removed in the draft.
    expect(lineInDraft(SAVED, withAbove.replace("the actions", "our list"), 4, RAW)).toBeNull();
    expect(lineInDraft(SAVED, "# Script\n", 4, RAW)).toBeNull();
    // The saved line no longer holds the link (the file changed since the panel was read).
    expect(lineInDraft(SAVED, withAbove, 5, RAW)).toBeNull();
    expect(lineInDraft(SAVED, withAbove, 99, RAW)).toBeNull();
  });
});
