// Due-date editing rules shared by the board, the calendar and issue details. They are plain
// functions, free of React, so that they can be unit-tested (DEC-023, R4-5, R5-11, R5-12).
import { localDateOf, localTimeOf, zonedTimeToUtcChecked, type Due } from "@nexus/schema";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The date shown in a date input for a due value (a timed value shows its own zone's date). */
export function dueInputValue(due: Due): string {
  if (!due) return "";
  return "date" in due ? due.date : localDateOf(due.dateTime, due.timeZone);
}
/**
 * The new due value for a chosen date: an all-day date, or a timed due date moved to that day
 * at the same local time in its own zone. A time that does not exist that day (the clocks go
 * forward) moves forward by the gap, and `adjustedTo` says to what (R4-10).
 */
export function dueFromInputChecked(current: Due, date: string): { due: Due; adjustedTo: string | null } {
  if (!date) return { due: null, adjustedTo: null };
  if (current && "dateTime" in current) {
    const r = zonedTimeToUtcChecked(date, localTimeOf(current.dateTime, current.timeZone), current.timeZone);
    return { due: { dateTime: r.instant.toISOString(), timeZone: current.timeZone }, adjustedTo: r.adjustedTo };
  }
  return { due: { date }, adjustedTo: null };
}
export const dueFromInput = (current: Due, date: string): Due => dueFromInputChecked(current, date).due;
/** A stored due value and the revision of the issue that holds it. */
export interface StoredDue { revision: number; due: Due }
/**
 * One open due-date editor. It is plain data, so that a view can keep it by issue ID while the
 * issue moves between day cells or columns (R5-11).
 */
export interface DueEdit {
  /** The date in the input, and the stored value it was typed over (the save's base). */
  draft: { value: string; base: StoredDue } | null;
  /** The service refused a save because the date had changed: the stored value it reported. */
  refused: StoredDue | null;
  saving: boolean;
  error: unknown;
}
export const NO_EDIT: DueEdit = { draft: null, refused: null, saving: false, error: null };
/** What a draft would save: its date, keeping the time and zone of the value it was typed over. */
export function draftDue(edit: DueEdit): { due: Due; adjustedTo: string | null } | null {
  return edit.draft ? dueFromInputChecked(edit.draft.base.due, edit.draft.value) : null;
}
/**
 * The newer stored date that an unsaved draft would replace, or null when there is nothing to
 * choose. It is reported as soon as the view shows the newer date, as well as when a save is
 * refused. A stored date equal to the draft is not a conflict: this tab's own save looks like
 * that while it is being acknowledged.
 */
export function dueConflict(edit: DueEdit, stored: StoredDue): StoredDue | null {
  if (!edit.draft || edit.saving) return null;
  const mine = draftDue(edit)!.due;
  if (!same(stored.due, edit.draft.base.due) && !same(stored.due, mine)) return { revision: stored.revision, due: stored.due };
  return edit.refused && !same(edit.refused.due, mine) ? edit.refused : null;
}
/** A date as the editors write it: "Sat 12 Dec 2026". */
export const dueDayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${date}T00:00:00Z`)).replace(",", "");
/** A due value in words: "no date", "Sat 12 Dec 2026", or "Thu 10 Dec 2026 23:15" in its own zone. */
export const describeDue = (due: Due) => (!due ? "no date" : "date" in due ? dueDayLabel(due.date)
  : `${dueDayLabel(localDateOf(due.dateTime, due.timeZone))} ${localTimeOf(due.dateTime, due.timeZone)}`);
