import { describe, expect, it } from "vitest";
import { checkCitedSection, resolveHeadingParam, type HeadingAlias } from "./headings";

// Run 6, R5-10 (independent run-5 review): a citation opens the section it read, not a newer
// heading of the same name, and says so when that cannot be told.
describe("R5-10: a cited section is checked against the text it read", () => {
  const note = "# Day\n\n## Tasks\n\nOrder lunch.\n\n## Tasks\n\nDeliver parcels.\n";
  const headings = [{ slug: "day", text: "Day", line: 0 }, { slug: "tasks", text: "Tasks", line: 2 }, { slug: "tasks-1", text: "Tasks", line: 6 }];
  it("follows the text to the original section after a same-named heading was inserted above it (the reviewer's case)", () => {
    expect(checkCitedSection(note, headings, "tasks", "Deliver parcels.")).toEqual({ slug: "tasks-1", moved: true, uncertain: false });
  });
  it("keeps a section that still holds the text, and reports a link whose text is nowhere as uncertain", () => {
    expect(checkCitedSection(note, headings, "tasks", "Order lunch.")).toEqual({ slug: "tasks", moved: false, uncertain: false });
    expect(checkCitedSection(note, headings, "tasks", "Book the van.")).toEqual({ slug: "tasks", moved: false, uncertain: true });
  });
  it("checks nothing for a citation from before run 6, which has no excerpt", () => {
    expect(checkCitedSection(note, headings, "tasks", null)).toEqual({ slug: "tasks", moved: false, uncertain: false });
  });
  it("marks a citation made before a run-4 rename that duplicated its heading's name as uncertain", () => {
    const uncertain: HeadingAlias = { slug: "beta", to: "beta", toText: "Beta", reason: "uncertain", ref: "accepted", at: "2026-11-24T12:00:00.000Z" };
    const before = resolveHeadingParam("beta", ["beta", "beta-1"], [uncertain], { ref: "accepted", at: "2026-11-24T10:00:00.000Z" });
    expect(before?.via?.reason).toBe("uncertain");
    const after = resolveHeadingParam("beta", ["beta", "beta-1"], [uncertain], { ref: "accepted", at: "2026-11-24T13:00:00.000Z" });
    expect(after?.via).toBeNull();
  });
});

const pending: HeadingAlias = { slug: "approved-heading", to: "pending-preview", toText: "Pending preview", reason: "pending-rename" };

describe("opening a heading link through renames", () => {
  it("opens a heading that is on disk directly", () => {
    expect(resolveHeadingParam("actions", ["actions"], [])).toEqual({ slug: "actions", via: null });
  });

  it("follows a pending, accepted or rejected rename to the heading on disk", () => {
    expect(resolveHeadingParam("approved-heading", ["pending-preview"], [pending])).toEqual({ slug: "pending-preview", via: pending });
    const accepted = { ...pending, reason: "renamed" as const };
    expect(resolveHeadingParam("approved-heading", ["pending-preview"], [accepted])?.via?.reason).toBe("renamed");
    const rejected: HeadingAlias = { slug: "pending-preview", to: "approved-heading", toText: "Approved heading", reason: "rename-rejected" };
    expect(resolveHeadingParam("pending-preview", ["approved-heading"], [rejected])).toEqual({ slug: "approved-heading", via: rejected });
  });

  it("follows a chain of renames, and gives up on a cycle or a dead end", () => {
    const second: HeadingAlias = { slug: "pending-preview", to: "final-copy", toText: "Final copy", reason: "renamed" };
    expect(resolveHeadingParam("approved-heading", ["final-copy"], [pending, second])?.slug).toBe("final-copy");
    const back: HeadingAlias = { slug: "pending-preview", to: "approved-heading", toText: "Approved heading", reason: "renamed" };
    expect(resolveHeadingParam("approved-heading", ["other"], [pending, back])).toBeNull();
    expect(resolveHeadingParam("missing", ["other"], [pending])).toBeNull();
  });
});
