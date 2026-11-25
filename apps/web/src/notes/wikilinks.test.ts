// [[ completion logic (.kiro/specs/backlinks-completion, requirement 3).
import { describe, expect, it } from "vitest";
import { parseHeadings, resolveHeading, slugOf } from "@nexus/markdown";
import { completableLinkAt, completion, headingNoteProblem, headingSuggestions, linkAt, noteSuggestions, type LinkToken } from "./wikilinks";

const NOTES = ["meetings/2026-11-24 kickoff.md", "meetings/notes.md", "planning/notes.md", "planning/demo script.md", "Kick-off ideas.md"];
/** The text with the caret at "|" removed: [text, caret]. */
const at = (marked: string): [string, number] => [marked.replace("¦", ""), marked.indexOf("¦")];
const apply = (text: string, t: LinkToken, value: string) => {
  const c = completion(t, value);
  return { text: text.slice(0, c.from) + c.insert + text.slice(c.to), caret: c.caret };
};

describe("finding the link the caret is in", () => {
  it("reads the target, heading and alias parts, open or closed", () => {
    expect(linkAt(...at("Ask [[kick¦"))).toMatchObject({ part: "target", query: "kick", target: "kick", closed: false });
    expect(linkAt(...at("Ask [[kick¦off]] now"))).toMatchObject({ part: "target", query: "kick", target: "kickoff", closed: true });
    expect(linkAt(...at("[[2026-11-24 kickoff#Ac¦"))).toMatchObject({ part: "heading", query: "Ac", target: "2026-11-24 kickoff", closed: false });
    expect(linkAt(...at("[[kickoff#Ac¦|the actions]]"))).toMatchObject({ part: "heading", query: "Ac", closed: true });
    expect(linkAt(...at("[[kickoff|the ac¦]]"))).toMatchObject({ part: "alias", query: "the ac" });
    expect(linkAt(...at("[[¦"))).toMatchObject({ part: "target", query: "", closed: false });
  });

  it("finds nothing outside a link, after a closed one, or across lines", () => {
    expect(linkAt(...at("plain text¦"))).toBeNull();
    expect(linkAt(...at("[[done]] and then¦"))).toBeNull();
    expect(linkAt(...at("[[open\nnext line¦"))).toBeNull();
    expect(linkAt(...at("single [bracket¦"))).toBeNull();
  });
});

describe("suggesting notes and headings", () => {
  it("ranks names that start with the query first, shows folders, and writes paths for shared names", () => {
    const s = noteSuggestions("kick", NOTES);
    expect(s.map((x) => x.label)).toEqual(["Kick-off ideas", "2026-11-24 kickoff"]);
    expect(s[1]).toMatchObject({ detail: "meetings", value: "2026-11-24 kickoff" });
    expect(noteSuggestions("notes", NOTES).map((x) => [x.label, x.detail, x.value])).toEqual([["notes", "meetings", "meetings/notes"], ["notes", "planning", "planning/notes"]]);
    expect(noteSuggestions("planning", NOTES).map((x) => x.label)).toEqual(["demo script", "notes"]);
    expect(noteSuggestions("nothing like it", NOTES)).toEqual([]);
  });

  it("suggests the headings of the named note, and says why when it cannot", () => {
    const headings = [{ text: "Kickoff, 24 November 2026", slug: "kickoff-24-november-2026", depth: 1 }, { text: "Decisions", slug: "decisions", depth: 2 }, { text: "Actions", slug: "actions", depth: 2 }];
    expect(headingSuggestions("ac", headings).map((h) => h.value)).toEqual(["Actions"]);
    expect(headingSuggestions("", headings).map((h) => h.value)).toEqual(["Kickoff, 24 November 2026", "Decisions", "Actions"]);
    const token = (target: string) => linkAt(`[[${target}#`, target.length + 3)!;
    expect(headingNoteProblem(token("2026-11-24 kickoff"), NOTES, null)).toEqual({ path: "meetings/2026-11-24 kickoff.md" });
    expect(headingNoteProblem(token("nowhere"), NOTES, null)).toEqual({ message: "No note is called “nowhere”." });
    expect(headingNoteProblem(token("notes"), NOTES, "Kick-off ideas.md")).toMatchObject({ message: expect.stringContaining("Several notes are called “notes”: meetings/notes, planning/notes") });
  });
});

// R6-14: two headings with the same text. The link written for the second must open the second
// in the preview (which follows slugOf of the heading part) and in the backlinks (resolveHeading).
describe("repeated headings", () => {
  const opens = (headings: ReturnType<typeof parseHeadings>, value: string) => [slugOf(value), resolveHeading(headings, slugOf(value), value).slug];

  it("writes the chosen heading's own slug when its text would open another, and says which is which", () => {
    const content = ["# Target", "", "## Monday", "", "### Tasks", "", "Order lunch.", "", "## Tuesday", "", "### Tasks", "", "Deliver parcels.", ""].join("\n");
    const headings = parseHeadings(content);
    const s = headingSuggestions("Tas", headings, content);
    expect(s.map((x) => [x.label, x.detail, x.value])).toEqual([["Tasks", "under Monday", "Tasks"], ["Tasks", "under Tuesday", "tasks-1"]]);
    expect(s.map((x) => opens(headings, x.value))).toEqual([["tasks", "tasks"], ["tasks-1", "tasks-1"]]);
    // Typing the slug finds the heading again.
    expect(headingSuggestions("tasks-1", headings, content).map((x) => x.value)).toEqual(["tasks-1"]);
  });

  it("uses the section's first line, then the position, when the parents are the same", () => {
    const content = ["# Target", "", "## Tasks", "", "- [ ] Order lunch for the whole team on Friday.", "", "## Tasks", "", "Deliver parcels.", "", "## Tasks", "", "Deliver parcels.", ""].join("\n");
    const headings = parseHeadings(content);
    expect(headingSuggestions("Tasks", headings, content).map((x) => [x.detail, x.value])).toEqual([
      ["“Order lunch for the whole team on…”", "Tasks"],
      ["2 of 3", "tasks-1"],
      ["3 of 3", "tasks-2"],
    ]);
  });

  it("never writes text that opens a different heading, or that would break the link", () => {
    const content = ["# Tasks", "", "# Tasks", "", "# Tasks 1", "", "# Q&A | notes", "", "# Odd ] one", ""].join("\n");
    const headings = parseHeadings(content);
    for (const s of headingSuggestions("", headings, content)) {
      const h = headings.find((x) => `heading:${x.slug}` === s.id)!;
      expect(opens(headings, s.value)).toEqual([h.slug, h.slug]);
      expect(s.value).not.toMatch(/[[\]|]/);
    }
  });
});

// R6-16: completion is offered where the preview would render a link, not in code.
describe("completion outside code only", () => {
  it("offers nothing for a [[ in fenced, indented or inline code", () => {
    expect(completableLinkAt(...at("```\n[[kick¦\n```"))).toBeNull();
    expect(completableLinkAt(...at("```\n[[kick¦"))).toBeNull();
    expect(completableLinkAt(...at("Text\n\n    [[kick¦"))).toBeNull();
    expect(completableLinkAt(...at("Use `[[kick¦` here"))).toBeNull();
    expect(completableLinkAt(...at("- Item\n\n    [[kick¦"))).toMatchObject({ part: "target", query: "kick" });
    expect(completableLinkAt(...at("Use `code` and [[kick¦"))).toMatchObject({ part: "target", query: "kick" });
  });
});

describe("inserting a suggestion", () => {
  it("closes an open link, keeps the text after it, and puts the caret after the link", () => {
    const [text, caret] = at("Ask [[kick¦ before Friday.");
    const out = apply(text, linkAt(text, caret)!, "2026-11-24 kickoff");
    expect(out.text).toBe("Ask [[2026-11-24 kickoff]] before Friday.");
    expect(out.text.slice(0, out.caret)).toBe("Ask [[2026-11-24 kickoff]]");
  });

  it("replaces only the target of a closed link, keeping its heading and alias", () => {
    const [text, caret] = at("See [[kick¦of#Actions|the actions]].");
    const out = apply(text, linkAt(text, caret)!, "2026-11-24 kickoff");
    expect(out.text).toBe("See [[2026-11-24 kickoff#Actions|the actions]].");
    expect(out.text.slice(0, out.caret)).toBe("See [[2026-11-24 kickoff");
  });

  it("inserts a heading, closing the link or keeping the alias", () => {
    const [open, c1] = at("[[2026-11-24 kickoff#Ac¦");
    expect(apply(open, linkAt(open, c1)!, "Actions").text).toBe("[[2026-11-24 kickoff#Actions]]");
    const [aliased, c2] = at("[[2026-11-24 kickoff#Ac¦|the list]] stays");
    expect(apply(aliased, linkAt(aliased, c2)!, "Actions").text).toBe("[[2026-11-24 kickoff#Actions|the list]] stays");
  });
});
