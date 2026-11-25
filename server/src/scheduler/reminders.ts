// Minimal reminder computation (seam for slice B4). The scheduler only ever
// sees accepted values: a value proposed by a change and not yet accepted is
// never scheduled (D-C3, PRD-066).
import {
  CalendarEvent, DEFAULT_REMINDER_SETTINGS, isTimeZone, localDateOf, localTimeOf, zonedTimeToUtc, zonedTimeToUtcChecked,
  type ChangeRecord, type Due, type Issue, type ReminderProblem, type ReminderSettings,
} from "@nexus/schema";
import { sameValue } from "../review/records";

// Shared with the board and calendar (packages/schema/src/time.ts).
export { zonedTimeToUtc };

/**
 * For each field touched by an unsettled change: if the field currently holds
 * the proposed value, use the change's `before`; otherwise the current value
 * is someone's newer manual work and stands.
 */
export function effectiveAcceptedIssues(issues: Issue[], unsettled: ChangeRecord[]): Issue[] {
  // A new issue still awaiting review is not accepted data (architecture 7.7), nor is a link
  // that a pending change added.
  const proposedIssues = new Set(unsettled.filter((c) => c.kind === "record.create").map((c) => c.target.recordId));
  // Newest first: if older journals hold two open changes to one field (new proposals can no
  // longer overlap, R4-2), undoing them in reverse order walks back to the accepted value.
  const newestFirst = [...unsettled].reverse();
  return issues.filter((issue) => !proposedIssues.has(issue.id)).map((issue) => {
    let out = issue;
    for (const c of newestFirst) {
      if (c.target.recordId !== issue.id) continue;
      if (c.kind === "record.addLink") {
        const link = c.after as { notePath: string; headingSlug: string | null };
        const i = out.noteLinks.findIndex((l) => l.notePath === link.notePath && l.headingSlug === link.headingSlug);
        if (i >= 0) out = { ...out, noteLinks: out.noteLinks.filter((_, n) => n !== i) };
        continue;
      }
      if (c.kind !== "record.updateField" || !c.target.field) continue;
      if (sameValue(out[c.target.field], c.after)) out = { ...out, [c.target.field]: c.before } as Issue;
    }
    return out;
  });
}

/** When a due value's reminder fires (B4 requirement 1), and the rule that says so. */
export function reminderInstant(due: Due, timeZone: string, settings: Pick<ReminderSettings, "allDayTime" | "timedOffsetMinutes"> = DEFAULT_REMINDER_SETTINGS): { at: Date; rule: string } | null {
  if (!due) return null;
  if ("date" in due) return { at: zonedTimeToUtcChecked(due.date, settings.allDayTime, timeZone).instant, rule: `allday-${settings.allDayTime.replace(":", "")}` };
  return { at: new Date(new Date(due.dateTime).getTime() - settings.timedOffsetMinutes * 60_000), rule: `before-${settings.timedOffsetMinutes}m` };
}

/** One reminder that will fire (or has fired) for an issue or an event. */
export interface Occurrence {
  key: string; kind: "issue" | "event"; targetId: string; targetKey: string; title: string; detail: string; rule: string; at: Date;
}

function detailFor(due: NonNullable<Due>, kind: "issue" | "event", timeZone: string): string {
  const verb = kind === "issue" ? "Due" : "Starts";
  if ("date" in due) return `${verb} today`;
  const own = localTimeOf(due.dateTime, due.timeZone);
  const here = localTimeOf(due.dateTime, timeZone);
  return due.timeZone === timeZone || own === here ? `${verb} at ${here}` : `${verb} at ${own} (${due.timeZone}), ${here} here`;
}

/**
 * Every reminder occurrence for accepted issues that are not done and for events with a start
 * (architecture section 8, DEC-009): the key is the target, the rule and the instant, so one
 * occurrence is delivered at most once, and a changed date or setting is a new occurrence.
 *
 * Each record is computed on its own (R5-4): one that cannot be scheduled, for example because
 * its zone does not exist, is passed to `skip` and the others are unaffected. A key that appears
 * twice is kept once (R5-6).
 */
export function occurrences(issues: Issue[], events: CalendarEvent[], settings: ReminderSettings, timeZone: string, skip: (problem: ReminderProblem) => void = () => undefined): Occurrence[] {
  if (!isTimeZone(timeZone)) {
    skip({ file: ".nexus/workspace.json", record: null, message: `Nexus does not recognise the workspace time zone "${timeZone}", so no reminders are scheduled.` });
    return [];
  }
  const out = new Map<string, Occurrence>();
  const add = (o: Occurrence) => { if (!out.has(o.key)) out.set(o.key, o); };
  for (const issue of issues) {
    if (issue.status === "done" || !issue.due) continue;
    const due = issue.due;
    isolated(() => {
      if ("timeZone" in due && !isTimeZone(due.timeZone)) throw new UnknownZone(due.timeZone);
      const r = reminderInstant(due, timeZone, settings)!;
      add({ key: `issue:${issue.id}:${r.rule}:${r.at.toISOString()}`, kind: "issue", targetId: issue.id, targetKey: issue.key, title: issue.title, detail: detailFor(due, "issue", timeZone), rule: r.rule, at: r.at });
    }, (why) => skip({ file: ".nexus/issues.json", record: issue.key, message: `${why} in its due date, so it has no reminder.` }));
  }
  for (const event of events) {
    if (event.reminder === false || !event.start) continue;
    const start = event.start;
    isolated(() => {
      if ("timeZone" in start && !isTimeZone(start.timeZone)) throw new UnknownZone(start.timeZone);
      const r = reminderInstant(start, timeZone, settings)!;
      const day = "date" in start ? start.date : localDateOf(start.dateTime, timeZone);
      add({ key: `event:${event.id}:${r.rule}:${r.at.toISOString()}`, kind: "event", targetId: event.id, targetKey: day.slice(0, 7), title: event.title, detail: detailFor(start, "event", timeZone), rule: r.rule, at: r.at });
    }, (why) => skip({ file: ".nexus/calendar.json", record: event.id, message: `${why} in its start, so it has no reminder.` }));
  }
  return [...out.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

class UnknownZone extends Error {
  constructor(readonly zone: string) { super(`Nexus does not recognise the time zone "${zone.slice(0, 64)}"`); }
}

/** Runs one record's computation; a failure is described to `onError` instead of stopping the rest. */
function isolated(fn: () => void, onError: (why: string) => void): boolean {
  try { fn(); return true; } catch (e) {
    onError(e instanceof UnknownZone ? e.message : e instanceof RangeError ? "Nexus could not work out the time" : "Nexus could not read the date");
    return false;
  }
}

/**
 * The events in `.nexus/calendar.json`, read one by one (R5-4, R5-6): a row that is not a valid
 * event, or that repeats an earlier row's ID, is skipped and reported, and the rest are kept.
 * Only a file whose outer shape is wrong is skipped as a whole.
 */
export function readCalendar(raw: string): { events: CalendarEvent[]; problems: ReminderProblem[] } {
  const file = ".nexus/calendar.json";
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  const shape = value as { schemaVersion?: unknown; events?: unknown } | null;
  if (!shape || typeof shape !== "object" || shape.schemaVersion !== 1 || !Array.isArray(shape.events)) {
    return { events: [], problems: [{ file, record: null, message: "The calendar file is not valid, so none of its events has a reminder." }] };
  }
  const events: CalendarEvent[] = [];
  const problems: ReminderProblem[] = [];
  const seen = new Set<string>();
  shape.events.forEach((row: unknown, i) => {
    const parsed = CalendarEvent.safeParse(row);
    const id = typeof (row as { id?: unknown } | null)?.id === "string" ? String((row as { id: string }).id).slice(0, 40) : null;
    const record = id ?? `event ${i + 1}`;
    if (!parsed.success) { problems.push({ file, record, message: `${describeRow(row, parsed.error.issues)}, so it has no reminder.` }); return; }
    if (seen.has(parsed.data.id)) { problems.push({ file, record, message: "Another event earlier in the file has the same ID, so only the first has a reminder." }); return; }
    seen.add(parsed.data.id);
    events.push(parsed.data);
  });
  return { events, problems };
}

function describeRow(row: unknown, issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const r = row as { start?: { timeZone?: unknown }; end?: { timeZone?: unknown } } | null;
  for (const part of ["start", "end"] as const) {
    const zone = r?.[part]?.timeZone;
    if (typeof zone === "string" && !isTimeZone(zone)) return `Nexus does not recognise the time zone "${zone.slice(0, 64)}" in its ${part}`;
  }
  const first = issues[0];
  return first ? `It is not a valid event (${first.path.map(String).join(".") || "event"}: ${first.message})` : "It is not a valid event";
}

export interface Reminder { key: string; issueKey: string; title: string; at: string }

/** Read-only preview: issue reminders whose time falls in (at - lookback, at]. */
export function dueReminders(issues: Issue[], opts: { at: Date; timeZone: string; lookbackHours?: number; settings?: ReminderSettings }): Reminder[] {
  const from = opts.at.getTime() - (opts.lookbackHours ?? 24) * 3_600_000;
  return occurrences(issues, [], opts.settings ?? DEFAULT_REMINDER_SETTINGS, opts.timeZone)
    .filter((o) => o.at.getTime() > from && o.at.getTime() <= opts.at.getTime())
    .map((o) => ({ key: o.key, issueKey: o.targetKey, title: o.title, at: o.at.toISOString() }));
}
