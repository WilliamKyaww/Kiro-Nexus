import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { localDateOf, localTimeOf, type Due, type Issue, type IssueView, type WorkspaceView } from "@nexus/schema";
import { ApiError, api } from "../api";
import { describeDue, dueConflict, dueDayLabel, dueFromInputChecked, dueInputValue, NO_EDIT, type DueEdit } from "./dueEdit";
import { fieldErrorMessage, useIssueField } from "./useIssueField";
export { dueFromInput, dueFromInputChecked, dueInputValue } from "./dueEdit";
const zoneName = (zone: string) => zone.split("/").pop()!.replace(/_/g, " ");
/** An editor's state and its updater. A view that must keep a draft by issue ID passes one in. */
export type DueEditState = readonly [DueEdit, (update: (edit: DueEdit) => DueEdit) => void];
/**
 * The notes under a due-date input: which zone the date belongs to, and a time that does not
 * exist on the chosen day. Shared by the date editor and issue details (DEC-023, R5-12).
 * `shape` is the value whose time and zone a chosen date keeps.
 */
export function DueDateNotes({ id, shape, date }: { id: string; shape: Due; date: string }) {
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const wsZone = workspace.data?.workspace?.timeZone ?? null;
  const timed = shape && "dateTime" in shape ? shape : null;
  const chosen = date ? dueFromInputChecked(shape, date) : null;
  const shownOn = chosen?.due && "dateTime" in chosen.due && wsZone && wsZone !== chosen.due.timeZone ? localDateOf(chosen.due.dateTime, wsZone) : null;
  return (
    <>
      <p className="muted due-zone" id={id}>
        {timed
          ? <>Due at {localTimeOf(timed.dateTime, timed.timeZone)} {zoneName(timed.timeZone)} time ({timed.timeZone}). The date is the day in that zone.{shownOn ? <> The calendar shows it on {dueDayLabel(shownOn)}, the day in this workspace&apos;s zone ({wsZone}).</> : null}</>
          : <>An all-day date in this workspace&apos;s zone{wsZone ? ` (${wsZone})` : ""}.</>}
      </p>
      {chosen?.adjustedTo && timed ? (
        <p className="notice" role="status">
          {localTimeOf(timed.dateTime, timed.timeZone)} does not exist on {dueDayLabel(date)} in {timed.timeZone}, because the clocks go forward. Nexus will save {chosen.adjustedTo}.
        </p>
      ) : null}
    </>
  );
}
/**
 * Shared by board cards and calendar items, so both views write identical due values.
 * The edit's base is the issue as it was when the user first changed the date: a save is then
 * checked against that, so another tab's newer date is reported, never overwritten (R4-5).
 * The choice is offered as soon as the newer date arrives, and a draft is never dropped
 * silently (R5-11). By default the editor keeps its own state; the calendar passes `edit` so
 * that a draft survives its issue moving to another day.
 */
export function DueDateEditor({ issue, pendingReview, onDone, edit }: { issue: Issue; pendingReview: boolean; onDone?: () => void; edit?: DueEditState }) {
  const id = useId();
  const local = useState<DueEdit>(NO_EDIT);
  const [state, setState] = edit ?? local;
  const update = useIssueField();
  const { draft } = state;
  const shape = draft?.base.due ?? issue.due; // a chosen date keeps this value's time and zone
  const value = draft?.value ?? dueInputValue(issue.due);
  const chosen = value ? dueFromInputChecked(shape, value) : null;
  const conflict = dueConflict(state, issue);
  // The result is applied through `setState`, not the mutation's per-call callbacks, so that it
  // still lands when the issue's new date has moved this editor to another day cell.
  const save = (due: Due, base = draft?.base ?? { revision: issue.revision, due: issue.due }) => {
    setState((s) => ({ ...s, saving: true, refused: null, error: null }));
    update.mutateAsync({ issue, patch: { due }, base: { revision: base.revision, values: { due: base.due } } }).then(
      () => { setState(() => NO_EDIT); onDone?.(); },
      (e: unknown) => {
        const current = e instanceof ApiError && e.code === "REVISION_MISMATCH" ? (e.details as { current?: IssueView } | undefined)?.current : undefined;
        // The draft stays in the field, unsaved.
        setState((s) => ({ ...s, saving: false, refused: current ? { revision: current.revision, due: current.due } : null, error: current ? null : e }));
      },
    );
  };
  const submit = (e: FormEvent) => { e.preventDefault(); save(chosen?.due ?? null); };
  const change = (next: string) => setState((s) => ({
    ...s, refused: null, error: null, draft: { value: next, base: s.draft?.base ?? { revision: issue.revision, due: issue.due } },
  }));
  return (
    <form className="due-editor" onSubmit={submit} aria-label={`Change the due date of ${issue.key}`}>
      <label htmlFor={id}>Due date of {issue.key}</label>
      <input id={id} type="date" value={value} onChange={(e) => change(e.target.value)} aria-describedby={`${id}-zone`} />
      <DueDateNotes id={`${id}-zone`} shape={shape} date={value} />
      {conflict ? (
        <div className="conflict" role="alert">
          <p>Someone else changed this due date to {describeDue(conflict.due)} since you started. Your date, {describeDue(chosen?.due ?? null)}, is not saved.</p>
          <div className="row">
            <button type="button" disabled={state.saving} onClick={() => save(chosen?.due ?? null, conflict)}>Keep mine</button>
            <button type="button" disabled={state.saving} onClick={() => setState(() => NO_EDIT)}>Use theirs</button>
          </div>
        </div>
      ) : null}
      <div className="row">
        <button type="submit" className="primary" disabled={state.saving || draft === null || value === dueInputValue(draft.base.due)}>Save date</button>
        {issue.due ? <button type="button" disabled={state.saving} onClick={() => save(null)}>Remove date</button> : null}
        {onDone ? <button type="button" className="link-button" onClick={onDone}>Cancel</button> : null}
      </div>
      {pendingReview ? <p className="muted">A change to this date is awaiting review. Saving a date by hand replaces it, and the review then shows a conflict.</p> : null}
      {state.error && !conflict ? <p className="error" role="alert">{fieldErrorMessage(state.error, issue.key)}</p> : null}
    </form>
  );
}
