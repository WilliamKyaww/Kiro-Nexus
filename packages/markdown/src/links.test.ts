// The shared wikilink rule (.kiro/specs/backlinks-completion, requirement 1).
import { describe, expect, it } from "vitest";
import { linkDisplay, linksIn, noteTargetFor, resolveNoteTarget } from "./links";

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
