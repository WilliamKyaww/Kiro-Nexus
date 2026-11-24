// Minimal reminder computation (seam for slice B4). The scheduler only ever
// sees accepted values: a value proposed by a change and not yet accepted is
// never scheduled (D-C3, PRD-066).
import { zonedTimeToUtc, type ChangeRecord, type Due, type Issue } from "@nexus/schema";
import { sameValue } from "../review/records";

// Shared with the board and calendar (packages/schema/src/time.ts).
export { zonedTimeToUtc };

/**
 * For each field touched by an unsettled change: if the field currently holds
 * the proposed value, use the change's `before`; otherwise the current value
 * is someone's newer manual work and stands.
 */
export function effectiveAcceptedIssues(issues: Issue[], unsettled: ChangeRecord[]): Issue[] {
  return issues.map((issue) => {
    let out = issue;
    for (const c of unsettled) {
      if (c.kind !== "record.updateField" || c.target.recordId !== issue.id || !c.target.field) continue;
      if (sameValue(out[c.target.field], c.after)) out = { ...out, [c.target.field]: c.before } as Issue;
    }
    return out;
  });
}

export function reminderInstant(due: Due, timeZone: string, localTime = "09:00"): Date | null {
  if (!due) return null;
  if ("date" in due) return zonedTimeToUtc(due.date, localTime, timeZone);
  return new Date(due.dateTime);
}

export interface Reminder { key: string; issueKey: string; title: string; at: string }

/** Reminders whose time falls in (at - lookback, at]. The dedup key is target, rule and instant (DEC-009). */
export function dueReminders(issues: Issue[], opts: { at: Date; timeZone: string; lookbackHours?: number }): Reminder[] {
  const from = opts.at.getTime() - (opts.lookbackHours ?? 24) * 3_600_000;
  const out: Reminder[] = [];
  for (const issue of issues) {
    if (issue.status === "done") continue;
    const instant = reminderInstant(issue.due, opts.timeZone);
    if (!instant) continue;
    const t = instant.getTime();
    if (t > from && t <= opts.at.getTime()) {
      out.push({ key: `issue:${issue.id}:due-0900:${instant.toISOString()}`, issueKey: issue.key, title: issue.title, at: instant.toISOString() });
    }
  }
  return out;
}
