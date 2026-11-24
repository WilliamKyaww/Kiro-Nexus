import { useId, useState, type FormEvent } from "react";
import { localDateOf, localTimeOf, zonedTimeToUtc, type Due, type Issue } from "@nexus/schema";
import { fieldErrorMessage, useIssueField } from "./useIssueField";

/** The date shown in a date input for a due value (a timed value shows its own zone's date). */
export function dueInputValue(due: Due): string {
  if (!due) return "";
  return "date" in due ? due.date : localDateOf(due.dateTime, due.timeZone);
}

/** The new due value for a chosen date: an all-day date, or a timed due date moved to that day at the same local time. */
export function dueFromInput(current: Due, date: string): Due {
  if (!date) return null;
  if (current && "dateTime" in current) {
    return { dateTime: zonedTimeToUtc(date, localTimeOf(current.dateTime, current.timeZone), current.timeZone).toISOString(), timeZone: current.timeZone };
  }
  return { date };
}

/** Shared by board cards and calendar items, so both views write identical due values. */
export function DueDateEditor({ issue, pendingReview, onDone }: { issue: Issue; pendingReview: boolean; onDone?: () => void }) {
  const id = useId();
  const [value, setValue] = useState(dueInputValue(issue.due));
  const update = useIssueField();
  const save = (due: Due) => update.mutate({ issue, patch: { due } }, { onSuccess: () => onDone?.() });
  const submit = (e: FormEvent) => { e.preventDefault(); save(dueFromInput(issue.due, value)); };
  return (
    <form className="due-editor" onSubmit={submit} aria-label={`Change the due date of ${issue.key}`}>
      <label htmlFor={id}>Due date of {issue.key}</label>
      <input id={id} type="date" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="row">
        <button type="submit" className="primary" disabled={update.isPending || value === dueInputValue(issue.due)}>Save date</button>
        {issue.due ? <button type="button" disabled={update.isPending} onClick={() => save(null)}>Remove date</button> : null}
        {onDone ? <button type="button" className="link-button" onClick={onDone}>Cancel</button> : null}
      </div>
      {pendingReview ? <p className="muted">A change to this date is awaiting review. Saving a date by hand replaces it, and the review then shows a conflict.</p> : null}
      {update.error ? <p className="error" role="alert">{fieldErrorMessage(update.error, issue.key)}</p> : null}
    </form>
  );
}
