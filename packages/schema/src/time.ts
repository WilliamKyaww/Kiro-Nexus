// Time-zone helpers shared by the service (scheduler) and the UI (board and calendar), so that
// every view puts a due date on the same local day (architecture section 6).

function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
}

/** Local wall-clock time in an IANA zone to a UTC instant (DST-safe for real times). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  let instant = guess - tzOffsetMs(guess, timeZone);
  instant = guess - tzOffsetMs(instant, timeZone);
  return new Date(instant);
}

/**
 * Like zonedTimeToUtc, and says when the wall-clock time does not exist on that day because
 * the clocks go forward (R4-10). Such a time moves forward by the size of the gap (01:30 becomes
 * 02:30 in Europe/London on 28 March 2027), and `adjustedTo` gives the time actually used. A time
 * that occurs twice when the clocks go back resolves to its first occurrence.
 */
export function zonedTimeToUtcChecked(date: string, time: string, timeZone: string): { instant: Date; adjustedTo: string | null } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // Both offsets around the guess: the earlier occurrence wins for a repeated time.
  const candidates = [guess - tzOffsetMs(guess - 12 * 3_600_000, timeZone), guess - tzOffsetMs(guess + 12 * 3_600_000, timeZone)];
  const exact = candidates.filter((c) => { const p = localParts(new Date(c), timeZone); return p.date === date && p.time === time; }).sort((a, b) => a - b)[0];
  if (exact !== undefined) return { instant: new Date(exact), adjustedTo: null };
  // In a gap: keep the offset from before the change, which moves the time forward by the gap.
  const instant = new Date(candidates[0]!);
  return { instant, adjustedTo: localParts(instant, timeZone).time };
}

function localParts(instant: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** The local date (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDateOf(instant: Date | string, timeZone: string): string {
  return localParts(instant, timeZone).date;
}

/** The local time (HH:MM, 24-hour) of an instant in an IANA zone. */
export function localTimeOf(instant: Date | string, timeZone: string): string {
  return localParts(instant, timeZone).time;
}

/** The local date a due value falls on in the workspace zone, or null for no due date. */
export function dueLocalDate(due: null | { date: string } | { dateTime: string; timeZone: string }, workspaceTimeZone: string): string | null {
  if (!due) return null;
  if ("date" in due) return due.date;
  return localDateOf(due.dateTime, workspaceTimeZone);
}
