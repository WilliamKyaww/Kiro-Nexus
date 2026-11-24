// R4-10 (Codex review of run 4): moving a 01:30 London deadline into the spring-forward gap
// silently gave 02:30. The checked conversion now says so. Also the day a London deadline
// falls on in a Tokyo workspace.
import { describe, expect, it } from "vitest";
import { localDateOf, localTimeOf, zonedTimeToUtcChecked } from "./time";

describe("wall-clock times across clock changes", () => {
  it("moves a time in the spring-forward gap forward by the gap, and says so", () => {
    expect(zonedTimeToUtcChecked("2027-03-28", "01:30", "Europe/London")).toEqual({ instant: new Date("2027-03-28T01:30:00.000Z"), adjustedTo: "02:30" });
    expect(zonedTimeToUtcChecked("2027-03-28", "00:30", "Europe/London")).toEqual({ instant: new Date("2027-03-28T00:30:00.000Z"), adjustedTo: null });
    expect(zonedTimeToUtcChecked("2027-03-28", "02:30", "Europe/London")).toEqual({ instant: new Date("2027-03-28T01:30:00.000Z"), adjustedTo: null });
  });

  it("uses the first occurrence of a time that happens twice when the clocks go back", () => {
    expect(zonedTimeToUtcChecked("2027-10-31", "01:30", "Europe/London")).toEqual({ instant: new Date("2027-10-31T00:30:00.000Z"), adjustedTo: null });
  });

  it("places a late London deadline on the next day in a Tokyo workspace", () => {
    const { instant } = zonedTimeToUtcChecked("2027-03-27", "23:30", "Europe/London");
    expect(instant.toISOString()).toBe("2027-03-27T23:30:00.000Z");
    expect([localDateOf(instant, "Asia/Tokyo"), localTimeOf(instant, "Asia/Tokyo")]).toEqual(["2027-03-28", "08:30"]);
    // Moved to 29 March in its own zone, after the clocks went forward in London.
    const moved = zonedTimeToUtcChecked("2027-03-29", "23:30", "Europe/London").instant;
    expect([localDateOf(moved, "Europe/London"), localTimeOf(moved, "Europe/London")]).toEqual(["2027-03-29", "23:30"]);
    expect(localDateOf(moved, "Asia/Tokyo")).toBe("2027-03-30");
  });
});
