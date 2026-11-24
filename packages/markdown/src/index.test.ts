import { describe, expect, it } from "vitest";
import { parseHeadings, parseWikilinks, resolveHeading } from "./index";

describe("parseHeadings", () => {
  it("returns slugs, depths and zero-based lines, de-duplicating repeats", () => {
    const md = "# Kickoff\n\n## Actions\ntext\n## Actions\n### **Bold** `code`";
    expect(parseHeadings(md)).toEqual([
      { depth: 1, text: "Kickoff", slug: "kickoff", line: 0 },
      { depth: 2, text: "Actions", slug: "actions", line: 2 },
      { depth: 2, text: "Actions", slug: "actions-1", line: 4 },
      { depth: 3, text: "Bold code", slug: "bold-code", line: 5 },
    ]);
  });

  it("ignores headings inside fenced code and handles CRLF", () => {
    const md = "# Real\r\n```md\r\n# Not a heading\r\n```\r\n## After";
    expect(parseHeadings(md).map((h) => h.slug)).toEqual(["real", "after"]);
  });

  it("requires a space after the hashes", () => {
    expect(parseHeadings("#hashtag\n# Heading")).toHaveLength(1);
  });
});

describe("parseWikilinks", () => {
  it("parses target, heading and alias", () => {
    expect(parseWikilinks("See [[Kickoff#Actions|the actions]] and [[Plan]].")).toMatchObject([
      { target: "Kickoff", heading: "Actions", alias: "the actions" },
      { target: "Plan", heading: null, alias: null },
    ]);
  });
});

describe("resolveHeading", () => {
  const headings = parseHeadings("# A\n## Actions\n## Notes");
  it("prefers the exact slug", () => expect(resolveHeading(headings, "actions", "Old")).toEqual({ slug: "actions", status: "ok" }));
  it("falls back to unique heading text", () => expect(resolveHeading(headings, "gone", "Notes")).toEqual({ slug: "notes", status: "ok" }));
  it("reports a missing heading", () => expect(resolveHeading(headings, "gone", "Gone")).toEqual({ slug: null, status: "heading-missing" }));
});
