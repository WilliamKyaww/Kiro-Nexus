import { describe, expect, it } from "vitest";
import { Issue, IssuesFile, serialise } from "./index";

const issue = {
  id: "iss_01JD3M8Q4K7Y2C9X5V6B1N0RTA",
  key: "NEX-1",
  projectId: "prj_01JD3M7Z4K7Y2C9X5V6B1N0RTA",
  title: "Build calendar view",
  description: "",
  status: "in_progress",
  priority: "high",
  due: { date: "2026-12-05" },
  rank: "a0",
  noteLinks: [{ notePath: "meetings/kickoff.md", headingSlug: "actions", headingText: "Actions" }],
  createdAt: "2026-11-24T18:00:00Z",
  updatedAt: "2026-11-24T18:00:00Z",
  revision: 1,
};

describe("schema", () => {
  it("accepts a valid issue and rejects unknown fields or bad status", () => {
    expect(Issue.safeParse(issue).success).toBe(true);
    expect(Issue.safeParse({ ...issue, extra: 1 }).success).toBe(false);
    expect(Issue.safeParse({ ...issue, status: "blocked" }).success).toBe(false);
    expect(Issue.safeParse({ ...issue, due: { date: "5 Dec" } }).success).toBe(false);
  });

  it("serialises deterministically regardless of input key order", () => {
    const shuffled = Object.fromEntries(Object.entries(issue).reverse());
    const a = serialise(IssuesFile, { schemaVersion: 1, issues: [issue] });
    const b = serialise(IssuesFile, { issues: [shuffled], schemaVersion: 1 });
    expect(a).toBe(b);
    expect(a.endsWith("}\n")).toBe(true);
    expect(serialise(IssuesFile, JSON.parse(a))).toBe(a);
  });
});
