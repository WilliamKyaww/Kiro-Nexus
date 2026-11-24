// Pure month arithmetic for the calendar: plain local dates (YYYY-MM-DD), Monday first.

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM for a local date. */
export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Day of week, 0 = Monday … 6 = Sunday, for a local date (calendar arithmetic, no time zone). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/**
 * The weeks shown for a month: Monday to Sunday, padded with the neighbouring months' days,
 * each day as { date, inMonth }.
 */
export function monthWeeks(month: string): Array<Array<{ date: string; inMonth: boolean }>> {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lead = weekdayOf(first);
  const count = daysInMonth(month);
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  const dateAt = (offset: number) => {
    const t = new Date(Date.UTC(y!, m! - 1, 1 + offset));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };
  for (let i = -lead; i < count; i++) cells.push({ date: dateAt(i), inMonth: i >= 0 });
  while (cells.length % 7 !== 0) cells.push({ date: dateAt(cells.length - lead), inMonth: false });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

export const dayTitle = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
