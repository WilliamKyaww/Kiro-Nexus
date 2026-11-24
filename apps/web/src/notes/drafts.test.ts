import { describe, expect, it } from "vitest";
import { createDraftStore, type DraftStorage } from "./drafts";

function fakeStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

describe("draft store", () => {
  it("scopes drafts to workspace and note, and survives a new store on the same storage (reload)", () => {
    const storage = fakeStorage();
    const a = createDraftStore(storage);
    a.set("wsp_A", "notes/plan.md", "draft in A", "sha256:1");
    a.set("wsp_B", "notes/plan.md", "draft in B", "sha256:9");
    const reloaded = createDraftStore(storage);
    expect(reloaded.get("wsp_A", "notes/plan.md")?.text).toBe("draft in A");
    expect(reloaded.get("wsp_B", "notes/plan.md")?.text).toBe("draft in B");
    expect(reloaded.get("wsp_A", "notes/other.md")).toBeNull();
    expect(reloaded.paths("wsp_A")).toEqual(["notes/plan.md"]);
  });

  it("a save acknowledgement clears only the version that was submitted", () => {
    const s = createDraftStore(fakeStorage());
    s.set("w", "n.md", "one\n", "sha256:base");
    s.set("w", "n.md", "one\ntwo typed during save\n", "sha256:base");
    const kept = s.acknowledgeSave("w", "n.md", "one\n", "sha256:saved");
    expect(kept).toMatchObject({ text: "one\ntwo typed during save\n", base: "sha256:saved" });
    expect(s.get("w", "n.md")?.text).toBe("one\ntwo typed during save\n");
    expect(s.acknowledgeSave("w", "n.md", "one\ntwo typed during save\n", "sha256:later")).toBeNull();
    expect(s.get("w", "n.md")).toBeNull();
  });

  it("keeps working in memory when storage is unavailable", () => {
    const s = createDraftStore(null);
    s.set("w", "n.md", "x", "b");
    expect(s.get("w", "n.md")?.text).toBe("x");
  });
});
