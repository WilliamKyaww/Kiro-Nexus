// Month calendar of dated issues (PRD-032; PRD-033 in part). Dates are local dates in the
// workspace time zone. Events and the agenda view are Hein's part of this area.
// Placeholder styling: Hein owns the final design.
import { useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { dueLocalDate, localDateOf, localTimeOf, type ChangeView, type Issue, type WorkspaceView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { addMonths, dayTitle, monthOf, monthTitle, monthWeeks } from "../calendar/month";
import { DueDateEditor, type DueEditState } from "../issues/DueDateEditor";
import { dueDayLabel, NO_EDIT, type DueEdit } from "../issues/dueEdit";
import { dueView } from "../issues/proposed";
import { useOpenChanges } from "../review/review";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
interface Item { issue: Issue; kind: "due" | "proposed"; changeId: string | null }
/** An open date editor, kept by issue ID with its unsaved state (R5-11). */
interface OpenEditor { key: string; edit: DueEdit }
/** What a day cell needs to show an issue's date editor. */
interface Editors {
  isOpen: (id: string) => boolean;
  toggle: (issue: Issue) => void;
  close: (id: string) => void;
  state: (id: string) => DueEditState;
  /** The issue whose editor had focus when it left one day cell, to refocus in the next. */
  refocus: MutableRefObject<string | null>;
}
export function CalendarPage() {
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const issues = useQuery({ queryKey: ["issues", "all"], queryFn: () => api.get<{ issues: Issue[] }>("/issues") });
  const changes = useOpenChanges();
  const [params, setParams] = useSearchParams();
  // Open editors live here, keyed by issue ID, not in the day cell. When another tab's save
  // moves an issue to another day, its editor and unsaved date move with it (R5-11).
  const [open, setOpen] = useState<ReadonlyMap<string, OpenEditor>>(() => new Map());
  const refocus = useRef<string | null>(null);
  const without = (m: ReadonlyMap<string, OpenEditor>, id: string) => { const n = new Map(m); n.delete(id); return n; };
  const editors: Editors = {
    isOpen: (id) => open.has(id),
    toggle: (issue) => setOpen((m) => (m.has(issue.id) ? without(m, issue.id) : new Map(m).set(issue.id, { key: issue.key, edit: NO_EDIT }))),
    close: (id) => setOpen((m) => (m.has(id) ? without(m, id) : m)),
    state: (id) => [open.get(id)?.edit ?? NO_EDIT, (update) => setOpen((m) => {
      const entry = m.get(id);
      return entry ? new Map(m).set(id, { ...entry, edit: update(entry.edit) }) : m; // a closed editor ignores late results
    })],
    refocus,
  };
  const tz = workspace.data?.workspace?.timeZone ?? "UTC";
  const today = localDateOf(new Date(), tz);
  const requested = params.get("month");
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : monthOf(today);
  const byDate = new Map<string, Item[]>();
  const put = (date: string | null, item: Item) => { if (date) byDate.set(date, [...(byDate.get(date) ?? []), item]); };
  for (const issue of issues.data?.issues ?? []) {
    const d = dueView(issue, changes);
    put(dueLocalDate(d.accepted, tz), { issue, kind: "due", changeId: null });
    if (d.proposed !== null) put(dueLocalDate(d.proposed, tz), { issue, kind: "proposed", changeId: d.changeId });
  }
  const weeks = monthWeeks(month);
  const datedThisMonth = weeks.flat().filter((d) => d.inMonth).reduce((n, d) => n + (byDate.get(d.date)?.length ?? 0), 0);
  // An unsaved date whose issue is no longer on a day shown here (another tab moved it to
  // another month or removed its date, or the user changed month) is kept above the grid.
  const shown = new Set(weeks.flat().flatMap((d) => (byDate.get(d.date) ?? []).filter((i) => i.kind === "due").map((i) => i.issue.id)));
  const issueById = new Map((issues.data?.issues ?? []).map((i) => [i.id, i]));
  const away = issues.data ? [...open].filter(([id, o]) => !shown.has(id) && (o.edit.draft !== null || o.edit.saving)) : [];
  return (
    <section className="page calendar-page" aria-labelledby="calendar-h">
      <h1 id="calendar-h">Calendar</h1>
      {issues.error ? <ErrorNote error={issues.error} /> : null}
      <div className="calendar-nav">
        <h2 id="month-h">{monthTitle(month)}</h2>
        <div className="row">
          <button type="button" onClick={() => setParams({ month: addMonths(month, -1) })}>Previous month</button>
          <button type="button" onClick={() => setParams({})} disabled={month === monthOf(today)}>Today</button>
          <button type="button" onClick={() => setParams({ month: addMonths(month, 1) })}>Next month</button>
        </div>
      </div>
      <p className="muted">Dated issues are shown on their local date in the workspace time zone ({tz}). {datedThisMonth === 0 ? "Nothing is dated this month." : ""}</p>
      {away.length ? (
        <section className="calendar-away" aria-label="Unsaved dates outside this month">
          {away.map(([id, o]) => {
            const issue = issueById.get(id);
            if (!issue) {
              return (
                <p key={id} className="notice" role="alert">
                  {o.key} is no longer in this workspace, so your date was not saved.{" "}
                  <button type="button" className="link-button" onClick={() => editors.close(id)}>Dismiss</button>
                </p>
              );
            }
            const on = dueLocalDate(dueView(issue, changes).accepted, tz);
            return (
              <CalendarEditor key={id} issue={issue} changes={changes} editors={editors} className="calendar-away-item"
                note={<>{issue.key} {issue.title} {on ? `is due on ${dueDayLabel(on)}, outside ${monthTitle(month)}.` : "no longer has a due date."} Your unsaved date is still here.</>} />
            );
          })}
        </section>
      ) : null}
      <div className="month" role="group" aria-labelledby="month-h">
        <div className="weekdays" aria-hidden="true">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
        <ol className="days">
          {weeks.flat().map((day, i) => {
            const items = byDate.get(day.date) ?? [];
            return (
              <li key={day.date} className={`day${day.inMonth ? "" : " outside"}${day.date === today ? " today" : ""}${items.length ? "" : " empty"}`}
                aria-label={`${dayTitle(day.date)}${day.date === today ? ", today" : ""}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
                data-date={day.date} data-weekday={i % 7}>
                <span className="day-number" aria-hidden="true">{Number(day.date.slice(8))}</span>
                <span className="day-title" aria-hidden="true">{dayTitle(day.date)}</span>
                {items.length ? (
                  <ul className="day-items">
                    {items.map((item) => <li key={`${item.issue.id}-${item.kind}`}><CalendarItem item={item} changes={changes} tz={tz} editors={editors} /></li>)}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="muted">Events and the agenda view are not available yet. Due dates set here and on the board are the same date on the same issue.</p>
    </section>
  );
}
function CalendarItem({ item, changes, tz, editors }: { item: Item; changes: ChangeView[]; tz: string; editors: Editors }) {
  const { issue } = item;
  // A timed due date sits on its day in the workspace zone; its time there explains the day (R4-10).
  const due = issue.due && "dateTime" in issue.due ? issue.due : null;
  const time = due ? <span className="cal-time" title={`${localTimeOf(due.dateTime, due.timeZone)} in ${due.timeZone}`}>{localTimeOf(due.dateTime, tz)}</span> : null;
  if (item.kind === "proposed") {
    return (
      <Link className="cal-item proposed" to={`/issues/${encodeURIComponent(issue.key)}${item.changeId ? `?change=${encodeURIComponent(item.changeId)}` : ""}`}
        data-testid={`proposed-${issue.key}`}>
        <span className="issue-key">{issue.key}</span> {issue.title} <span className="proposed-tag">Proposed</span>
      </Link>
    );
  }
  const open = editors.isOpen(issue.id);
  return (
    <div className="cal-entry" data-testid={`due-${issue.key}`}>
      <button type="button" className="cal-item" aria-expanded={open} onClick={() => editors.toggle(issue)}>
        {time} <span className="issue-key">{issue.key}</span> {issue.title}
      </button>
      {open ? <CalendarEditor issue={issue} changes={changes} editors={editors} className="cal-popover" /> : null}
    </div>
  );
}
/** The link and date editor for one issue, in its day cell or above the grid. */
function CalendarEditor({ issue, changes, editors, className, note }: { issue: Issue; changes: ChangeView[]; editors: Editors; className: string; note?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const { refocus } = editors;
  // When the issue moves to another day, this editor is replaced by one in the new cell. Focus
  // goes with it, so that someone typing a date is not left on the page body.
  useLayoutEffect(() => {
    const el = box.current;
    if (refocus.current === issue.id) {
      refocus.current = null;
      if (!document.activeElement || document.activeElement === document.body) el?.querySelector<HTMLInputElement>("input[type=date]")?.focus();
    }
    return () => { if (el?.contains(document.activeElement)) refocus.current = issue.id; };
  }, [issue.id, refocus]);
  return (
    <div className={className} ref={box}>
      {note ? <p>{note}</p> : null}
      <Link to={`/issues/${encodeURIComponent(issue.key)}`}>Open {issue.key}</Link>
      <DueDateEditor issue={issue} pendingReview={dueView(issue, changes).proposed !== null}
        edit={editors.state(issue.id)} onDone={() => editors.close(issue.id)} />
    </div>
  );
}
