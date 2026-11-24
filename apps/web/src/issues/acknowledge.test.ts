import { describe, expect, it } from "vitest";
import type { IssueView } from "@nexus/schema";
import { acknowledge, type IssueDraft } from "./acknowledge";

const issue = (over: Partial<IssueView>): IssueView => ({
  id: "iss_01KAR5Y3S0M8Q4K7Y2C9X5V6B1", key: "NEX-1", projectId: "prj_01KAR5Y3S0M8Q4K7Y2C9X5V6B2", projectKey: "NEX",
  title: "Build calendar view", description: "", status: "todo", priority: "medium", due: null, rank: "a0",
  noteLinks: [], links: [], createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z", revision: 1,
  ...over,
} as IssueView);

describe("acknowledging an issue save", () => {
  const base = issue({});

  it("clears the draft when nothing was typed during the save", () => {
    const draft: IssueDraft = { values: { title: "First" }, base };
    expect(acknowledge(draft, { title: "First" }, issue({ title: "First", revision: 2 }))).toBeNull();
  });

  it("keeps a field typed again during the save, based on the saved value", () => {
    const draft: IssueDraft = { values: { title: "Newer" }, base };
    const next = acknowledge(draft, { title: "First" }, issue({ title: "First", revision: 2 }));
    expect(next).toMatchObject({ values: { title: "Newer" }, base: { title: "First", revision: 2 } });
  });

  it("keeps a field first typed during the save on its original base and revision", () => {
    const draft: IssueDraft = { values: { title: "First", description: "Typed during save" }, base };
    const next = acknowledge(draft, { title: "First" }, issue({ title: "First", revision: 2 }));
    expect(next).toMatchObject({ values: { description: "Typed during save" }, base: { title: "First", description: "", revision: 1 } });
    expect(next!.values).not.toHaveProperty("title");
  });

  it("does nothing when the draft was discarded during the save", () => {
    expect(acknowledge(null, { title: "First" }, issue({ title: "First", revision: 2 }))).toBeNull();
  });
});
