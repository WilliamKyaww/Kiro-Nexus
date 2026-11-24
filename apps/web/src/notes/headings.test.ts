import { describe, expect, it } from "vitest";
import { resolveHeadingParam, type HeadingAlias } from "./headings";

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
