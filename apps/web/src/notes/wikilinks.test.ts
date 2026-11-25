// [[ completion logic (.kiro/specs/backlinks-completion, requirement 3).
import { describe, expect, it } from "vitest";
import { completion, headingNoteProblem, headingSuggestions, linkAt, noteSuggestions, type LinkToken } from "./wikilinks";

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
