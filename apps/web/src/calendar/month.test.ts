import { describe, expect, it } from "vitest";
import { dueLocalDate, localDateOf, localTimeOf, zonedTimeToUtc } from "@nexus/schema";
import { addMonths, monthWeeks, weekdayOf } from "./month";

describe("month weeks", () => {
  it("start on Monday and pad with the neighbouring months", () => {
    const weeks = monthWeeks("2026-12"); // 1 December 2026 is a Tuesday
    expect(weeks[0]![0]).toEqual({ date: "2026-11-30", inMonth: false });
    expect(weeks[0]![1]).toEqual({ date: "2026-12-01", inMonth: true });
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(weeks.at(-1)!.at(-1)).toEqual({ date: "2027-01-03", inMonth: false });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("handle a month that starts on a Sunday and a leap February", () => {
    expect(weekdayOf("2026-11-01")).toBe(6); // Sunday
    expect(monthWeeks("2026-11")[0]!.slice(0, 7).map((d) => d.inMonth)).toEqual([false, false, false, false, false, false, true]);
    expect(monthWeeks("2028-02").flat().filter((d) => d.inMonth)).toHaveLength(29);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
  });
});

describe("shared time helpers", () => {
  it("place timed due dates on the workspace's local day, across a clock change", () => {
    // 23:30 in London on 27 March 2027 is before the clocks go forward that night.
    const instant = zonedTimeToUtc("2027-03-27", "23:30", "Europe/London");
    expect(instant.toISOString()).toBe("2027-03-27T23:30:00.000Z");
    expect(localDateOf(instant, "Europe/London")).toBe("2027-03-27");
    const summer = zonedTimeToUtc("2027-03-28", "09:00", "Europe/London");
    expect(summer.toISOString()).toBe("2027-03-28T08:00:00.000Z");
    expect(localTimeOf(summer, "Europe/London")).toBe("09:00");
    // The same instant is the next day in Tokyo.
    expect(dueLocalDate({ dateTime: instant.toISOString(), timeZone: "Europe/London" }, "Asia/Tokyo")).toBe("2027-03-28");
    expect(dueLocalDate({ date: "2026-12-05" }, "Asia/Tokyo")).toBe("2026-12-05");
    expect(dueLocalDate(null, "Europe/London")).toBeNull();
  });
});
