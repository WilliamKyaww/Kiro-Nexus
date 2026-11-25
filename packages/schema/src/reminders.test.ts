// The shared calendar record (read by reminders, written by Hein's slice): an event's zones must
// be real IANA zones, and event IDs must be unique, so a bad row is refused where it is written
// (R5-4 and R5-6 in Astra 6.2's run-5 review).
import { describe, expect, it } from "vitest";
import { CalendarEvent, CalendarFile, isTimeZone } from "./reminders";

const event = (id: string, timeZone: string) => ({ id, title: "Fictional demo rehearsal", start: { dateTime: "2026-12-09T10:00:00.000Z", timeZone } });
const E1 = "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E1";
const E2 = "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E2";

describe("calendar events", () => {
  it("R5-4: accepts real IANA zones and refuses a misspelt one in the start or the end", () => {
    for (const zone of ["Europe/London", "Asia/Tokyo", "UTC", "America/Argentina/Buenos_Aires"]) {
      expect(isTimeZone(zone)).toBe(true);
      expect(CalendarEvent.safeParse(event(E1, zone)).success).toBe(true);
    }
    for (const zone of ["Europe/Londn", "Mars/Olympus", " ", "London"]) expect(isTimeZone(zone)).toBe(false);
    expect(CalendarEvent.safeParse(event(E1, "Europe/Londn")).success).toBe(false);
    expect(CalendarEvent.safeParse({ ...event(E1, "Europe/London"), end: { dateTime: "2026-12-09T11:00:00.000Z", timeZone: "Europe/Londn" } }).success).toBe(false);
    expect(CalendarFile.safeParse({ schemaVersion: 1, events: [event(E1, "Europe/Londn")] }).success).toBe(false);
  });

  it("R5-6: refuses a file in which two events share an ID", () => {
    expect(CalendarFile.safeParse({ schemaVersion: 1, events: [event(E1, "Europe/London"), event(E2, "Europe/London")] }).success).toBe(true);
    const twice = CalendarFile.safeParse({ schemaVersion: 1, events: [event(E1, "Europe/London"), event(E1, "Europe/London")] });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(["events", 1, "id"]);
  });
});
