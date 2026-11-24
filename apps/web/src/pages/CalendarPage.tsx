// Month calendar of dated issues (PRD-032; PRD-033 in part). Dates are local dates in the
// workspace time zone. Events and the agenda view are Hein's part of this area.
// Placeholder styling: Hein owns the final design.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { dueLocalDate, localDateOf, type ChangeView, type Issue, type WorkspaceView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { addMonths, dayTitle, monthOf, monthTitle, monthWeeks } from "../calendar/month";
import { DueDateEditor } from "../issues/DueDateEditor";
import { dueView } from "../issues/proposed";
import { useOpenChanges } from "../review/review";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Item { issue: Issue; kind: "due" | "proposed"; changeId: string | null }

export function CalendarPage() {
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const issues = useQuery({ queryKey: ["issues", "all"], queryFn: () => api.get<{ issues: Issue[] }>("/issues") });
  const changes = useOpenChanges();
  const [params, setParams] = useSearchParams();
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
                    {items.map((item) => <li key={`${item.issue.id}-${item.kind}`}><CalendarItem item={item} changes={changes} /></li>)}
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

function CalendarItem({ item, changes }: { item: Item; changes: ChangeView[] }) {
  const [open, setOpen] = useState(false);
  const { issue } = item;
  if (item.kind === "proposed") {
    return (
      <Link className="cal-item proposed" to={`/issues/${encodeURIComponent(issue.key)}${item.changeId ? `?change=${encodeURIComponent(item.changeId)}` : ""}`}
        data-testid={`proposed-${issue.key}`}>
        <span className="issue-key">{issue.key}</span> {issue.title} <span className="proposed-tag">Proposed</span>
      </Link>
    );
  }
  return (
    <div className="cal-entry" data-testid={`due-${issue.key}`}>
      <button type="button" className="cal-item" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="issue-key">{issue.key}</span> {issue.title}
      </button>
      {open ? (
        <div className="cal-popover">
          <Link to={`/issues/${encodeURIComponent(issue.key)}`}>Open {issue.key}</Link>
          <DueDateEditor issue={issue} pendingReview={dueView(issue, changes).proposed !== null} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
