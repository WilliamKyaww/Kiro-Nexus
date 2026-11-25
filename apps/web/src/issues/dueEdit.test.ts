import { describe, expect, it } from "vitest";
import type { Due } from "@nexus/schema";
import { describeDue, draftDue, dueConflict, dueInputValue, NO_EDIT, type DueEdit } from "./dueEdit";
const london = (dateTime: string): Due => ({ dateTime, timeZone: "Europe/London" });
const editOver = (due: Due, value: string, over: Partial<DueEdit> = {}): DueEdit => ({ ...NO_EDIT, draft: { value, base: { revision: 1, due } }, ...over });
describe("the value a due-date draft saves", () => {
  it("keeps a timed deadline's time and zone (R5-12)", () => {
    expect(draftDue(editOver(london("2026-12-10T23:15:00.000Z"), "2026-12-15"))).toEqual({ due: london("2026-12-15T23:15:00.000Z"), adjustedTo: null });
  });
  it("keeps an all-day date all-day, and an empty input removes the date", () => {
    expect(draftDue(editOver({ date: "2026-12-05" }, "2026-12-09"))!.due).toEqual({ date: "2026-12-09" });
    expect(draftDue(editOver({ date: "2026-12-05" }, ""))!.due).toBeNull();
  });
  it("moves a time in a clock gap forward and says so", () => {
    expect(draftDue(editOver(london("2027-03-27T01:30:00.000Z"), "2027-03-28"))).toEqual({ due: london("2027-03-28T01:30:00.000Z"), adjustedTo: "02:30" });
  });
  it("shows a timed value's date in its own zone", () => {
    expect(dueInputValue(london("2026-12-10T23:15:00.000Z"))).toBe("2026-12-10");
    expect(dueInputValue({ dateTime: "2026-12-10T23:15:00.000Z", timeZone: "Asia/Tokyo" })).toBe("2026-12-11");
  });
});
describe("a newer stored date under a draft (R4-5, R5-11)", () => {
  const draft = editOver({ date: "2026-12-05" }, "2026-12-09");
  it("is reported as soon as the view shows it, before any save", () => {
    expect(dueConflict(draft, { revision: 2, due: { date: "2026-12-12" } })).toEqual({ revision: 2, due: { date: "2026-12-12" } });
  });
  it("is not reported while the stored date is still the one the draft was typed over", () => {
    expect(dueConflict(draft, { revision: 2, due: { date: "2026-12-05" } })).toBeNull(); // another field changed
    expect(dueConflict(NO_EDIT, { revision: 2, due: { date: "2026-12-12" } })).toBeNull(); // nothing unsaved
  });
  it("is not this tab's own save arriving, or a save in flight", () => {
    expect(dueConflict(draft, { revision: 2, due: { date: "2026-12-09" } })).toBeNull();
    expect(dueConflict({ ...draft, saving: true }, { revision: 2, due: { date: "2026-12-12" } })).toBeNull();
  });
  it("keeps a refused save's report until the view catches up", () => {
    const refused = { ...draft, refused: { revision: 2, due: { date: "2026-12-12" } } };
    expect(dueConflict(refused, { revision: 1, due: { date: "2026-12-05" } })).toEqual({ revision: 2, due: { date: "2026-12-12" } });
  });
  it("reports the stored date's removal", () => {
    expect(dueConflict(draft, { revision: 2, due: null })).toEqual({ revision: 2, due: null });
  });
});
describe("due values in words", () => {
  it("names the day, and a timed value's time in its own zone", () => {
    expect(describeDue(null)).toBe("no date");
    expect(describeDue({ date: "2026-12-12" })).toBe("Sat 12 Dec 2026");
    expect(describeDue(london("2026-12-10T23:15:00.000Z"))).toBe("Thu 10 Dec 2026 23:15");
  });
});
