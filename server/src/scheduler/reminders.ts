// Minimal reminder computation (seam for slice B4). The scheduler only ever
// sees accepted values: a value proposed by a change and not yet accepted is
// never scheduled (D-C3, PRD-066).
import {
  DEFAULT_REMINDER_SETTINGS, localDateOf, localTimeOf, zonedTimeToUtc, zonedTimeToUtcChecked,
  type CalendarEvent, type ChangeRecord, type Due, type Issue, type ReminderSettings,
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
 */
export function occurrences(issues: Issue[], events: CalendarEvent[], settings: ReminderSettings, timeZone: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const issue of issues) {
    if (issue.status === "done" || !issue.due) continue;
    const r = reminderInstant(issue.due, timeZone, settings)!;
    out.push({ key: `issue:${issue.id}:${r.rule}:${r.at.toISOString()}`, kind: "issue", targetId: issue.id, targetKey: issue.key, title: issue.title, detail: detailFor(issue.due, "issue", timeZone), rule: r.rule, at: r.at });
  }
  for (const event of events) {
    if (event.reminder === false || !event.start) continue;
    const r = reminderInstant(event.start, timeZone, settings)!;
    const day = "date" in event.start ? event.start.date : localDateOf(event.start.dateTime, timeZone);
    out.push({ key: `event:${event.id}:${r.rule}:${r.at.toISOString()}`, kind: "event", targetId: event.id, targetKey: day.slice(0, 7), title: event.title, detail: detailFor(event.start, "event", timeZone), rule: r.rule, at: r.at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface Reminder { key: string; issueKey: string; title: string; at: string }

/** Read-only preview: issue reminders whose time falls in (at - lookback, at]. */
export function dueReminders(issues: Issue[], opts: { at: Date; timeZone: string; lookbackHours?: number; settings?: ReminderSettings }): Reminder[] {
  const from = opts.at.getTime() - (opts.lookbackHours ?? 24) * 3_600_000;
  return occurrences(issues, [], opts.settings ?? DEFAULT_REMINDER_SETTINGS, opts.timeZone)
    .filter((o) => o.at.getTime() > from && o.at.getTime() <= opts.at.getTime())
    .map((o) => ({ key: o.key, issueKey: o.targetKey, title: o.title, at: o.at.toISOString() }));
}
