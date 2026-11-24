// B4 requirement 1: which reminders exist and when they fire (architecture sections 6 and 8).
import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_SETTINGS, type CalendarEvent, type Issue } from "@nexus/schema";
import { occurrences } from "./reminders";

const issue = (key: string, due: Issue["due"], status: Issue["status"] = "todo"): Issue => ({
  id: `iss_01KAR5Y3S2M8Q4K7Y2C9X5V6${key.replace(/\D/g, "").padStart(2, "0")}`, key, projectId: "prj_01KAR5Y3S1M8Q4K7Y2C9X5V6B2",
  title: `Fictional task ${key}`, description: "", status, priority: "medium", due, rank: "00000001", noteLinks: [],
  createdAt: "2026-11-24T09:00:00.000Z", updatedAt: "2026-11-24T09:00:00.000Z", revision: 1,
});
const at = (list: ReturnType<typeof occurrences>) => list.map((o) => [o.targetKey, o.at.toISOString(), o.rule, o.detail]);

describe("reminder occurrences", () => {
  it("fires an all-day date at 09:00 in the workspace zone, across the London clock change", () => {
    const list = occurrences([issue("NEX-1", { date: "2027-03-27" }), issue("NEX-2", { date: "2027-03-29" })], [], DEFAULT_REMINDER_SETTINGS, "Europe/London");
    expect(at(list)).toEqual([
      ["NEX-1", "2027-03-27T09:00:00.000Z", "allday-0900", "Due today"], // GMT
      ["NEX-2", "2027-03-29T08:00:00.000Z", "allday-0900", "Due today"], // BST
    ]);
    expect(list[0]!.key).toBe("issue:iss_01KAR5Y3S2M8Q4K7Y2C9X5V601:allday-0900:2027-03-27T09:00:00.000Z");
  });

  it("fires a timed deadline the set number of minutes before it, and says when it is in both zones", () => {
    const deadline = issue("NEX-3", { dateTime: "2027-03-27T23:30:00.000Z", timeZone: "Europe/London" });
    expect(at(occurrences([deadline], [], DEFAULT_REMINDER_SETTINGS, "Asia/Tokyo"))).toEqual([
      ["NEX-3", "2027-03-27T22:30:00.000Z", "before-60m", "Due at 23:30 (Europe/London), 08:30 here"],
    ]);
    expect(at(occurrences([deadline], [], { ...DEFAULT_REMINDER_SETTINGS, timedOffsetMinutes: 0 }, "Europe/London"))[0]).toEqual(["NEX-3", "2027-03-27T23:30:00.000Z", "before-0m", "Due at 23:30"]);
  });

  it("uses the settings' time, and skips done issues and undated ones", () => {
    const list = occurrences([issue("NEX-4", { date: "2026-12-05" }), issue("NEX-5", { date: "2026-12-05" }, "done"), issue("NEX-6", null)], [], { ...DEFAULT_REMINDER_SETTINGS, allDayTime: "07:15" }, "Asia/Tokyo");
    expect(at(list)).toEqual([["NEX-4", "2026-12-04T22:15:00.000Z", "allday-0715", "Due today"]]);
  });

  it("includes calendar events by the same rules, unless their reminder is off", () => {
    const events: CalendarEvent[] = [
      { id: "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E1", title: "Fictional demo rehearsal", start: { dateTime: "2026-12-02T15:00:00.000Z", timeZone: "Europe/London" } },
      { id: "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E2", title: "Fictional quiet day", start: { date: "2026-12-03" }, reminder: false },
    ];
    expect(occurrences([], events, DEFAULT_REMINDER_SETTINGS, "Europe/London").map((o) => [o.kind, o.targetKey, o.at.toISOString(), o.detail]))
      .toEqual([["event", "2026-12", "2026-12-02T14:00:00.000Z", "Starts at 15:00"]]);
  });
});
