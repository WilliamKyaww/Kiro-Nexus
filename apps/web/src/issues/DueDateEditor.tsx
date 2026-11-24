import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { localDateOf, localTimeOf, zonedTimeToUtcChecked, type Due, type Issue, type IssueView, type WorkspaceView } from "@nexus/schema";
import { ApiError, api } from "../api";
import { fieldErrorMessage, useIssueField } from "./useIssueField";

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

const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");
const zoneName = (zone: string) => zone.split("/").pop()!.replace(/_/g, " ");
const describe = (due: Due) => (!due ? "no date" : "date" in due ? dayLabel(due.date) : `${dayLabel(localDateOf(due.dateTime, due.timeZone))} ${localTimeOf(due.dateTime, due.timeZone)}`);

/**
 * Shared by board cards and calendar items, so both views write identical due values.
 * The edit's base is the issue as it was when the user first changed the date: a save is then
 * checked against that, so another tab's newer date is reported, never overwritten (R4-5).
 */
export function DueDateEditor({ issue, pendingReview, onDone }: { issue: Issue; pendingReview: boolean; onDone?: () => void }) {
  const id = useId();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const wsZone = workspace.data?.workspace?.timeZone ?? null;
  const [draft, setDraft] = useState<{ value: string; base: { revision: number; due: Due } } | null>(null);
  const [conflict, setConflict] = useState<{ current: IssueView } | null>(null);
  const update = useIssueField();
  const value = draft?.value ?? dueInputValue(issue.due);
  const timed = issue.due && "dateTime" in issue.due ? issue.due : null;
  const chosen = value ? dueFromInputChecked(issue.due, value) : null;
  const shownOn = chosen?.due && "dateTime" in chosen.due && wsZone && wsZone !== chosen.due.timeZone ? localDateOf(chosen.due.dateTime, wsZone) : null;

  const save = (due: Due, base = draft?.base ?? { revision: issue.revision, due: issue.due }) => update.mutate(
    { issue, patch: { due }, base: { revision: base.revision, values: { due: base.due } } },
    {
      onSuccess: () => { setDraft(null); setConflict(null); onDone?.(); },
      onError: (e) => {
        const current = e instanceof ApiError && e.code === "REVISION_MISMATCH" ? (e.details as { current?: IssueView } | undefined)?.current : undefined;
        if (current) setConflict({ current }); // the draft stays in the field, unsaved
      },
    },
  );
  const submit = (e: FormEvent) => { e.preventDefault(); save(chosen?.due ?? null); };
  const change = (next: string) => {
    setConflict(null);
    setDraft({ value: next, base: draft?.base ?? { revision: issue.revision, due: issue.due } });
  };

  return (
    <form className="due-editor" onSubmit={submit} aria-label={`Change the due date of ${issue.key}`}>
      <label htmlFor={id}>Due date of {issue.key}</label>
      <input id={id} type="date" value={value} onChange={(e) => change(e.target.value)} aria-describedby={`${id}-zone`} />
      <p className="muted due-zone" id={`${id}-zone`}>
        {timed
          ? <>Due at {localTimeOf(timed.dateTime, timed.timeZone)} {zoneName(timed.timeZone)} time ({timed.timeZone}). The date is the day in that zone.{shownOn ? <> The calendar shows it on {dayLabel(shownOn)}, the day in this workspace&apos;s zone ({wsZone}).</> : null}</>
          : <>An all-day date in this workspace&apos;s zone{wsZone ? ` (${wsZone})` : ""}.</>}
      </p>
      {chosen?.adjustedTo && timed ? (
        <p className="notice" role="status">
          {localTimeOf(timed.dateTime, timed.timeZone)} does not exist on {dayLabel(value)} in {timed.timeZone}, because the clocks go forward. Nexus will save {chosen.adjustedTo}.
        </p>
      ) : null}
      {conflict ? (
        <div className="conflict" role="alert">
          <p>Someone else changed this due date to {describe(conflict.current.due)} since you started. Your date, {describe(chosen?.due ?? null)}, is not saved.</p>
          <div className="row">
            <button type="button" onClick={() => save(chosen?.due ?? null, { revision: conflict.current.revision, due: conflict.current.due })}>Keep mine</button>
            <button type="button" onClick={() => { setDraft(null); setConflict(null); }}>Use theirs</button>
          </div>
        </div>
      ) : null}
      <div className="row">
        <button type="submit" className="primary" disabled={update.isPending || draft === null || value === dueInputValue(draft.base.due)}>Save date</button>
        {issue.due ? <button type="button" disabled={update.isPending} onClick={() => save(null)}>Remove date</button> : null}
        {onDone ? <button type="button" className="link-button" onClick={onDone}>Cancel</button> : null}
      </div>
      {pendingReview ? <p className="muted">A change to this date is awaiting review. Saving a date by hand replaces it, and the review then shows a conflict.</p> : null}
      {update.error && !conflict ? <p className="error" role="alert">{fieldErrorMessage(update.error, issue.key)}</p> : null}
    </form>
  );
}
