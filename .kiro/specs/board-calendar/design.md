# Design: B3 board and calendar, first slice

## Components

| Module | Responsibility |
| --- | --- |
| `packages/schema/src/time.ts` | `zonedTimeToUtc` (moved from the scheduler, which re-exports it), `localDateOf(instant, timeZone)` and `localTimeOf`. They are shared by the service and the UI, so the board, the calendar and reminders agree on dates |
| `apps/web/src/issues/useIssueField.ts` | One mutation for single-field edits from the board and the calendar: `PATCH /issues/:key` with `baseRevision` and `baseValues` (the field merge, DEC-015). It reports `REVISION_MISMATCH` as a plain message and refreshes |
| `apps/web/src/issues/DueDateEditor.tsx` | A small, labelled date editor shared by board cards and calendar items. It sets `{ date }`; for a timed due date it keeps the local time in the issue's zone (`zonedTimeToUtc`). It also offers "Remove date" |
| `apps/web/src/issues/proposed.ts` | From open review changes, the accepted and proposed due date of each issue (architecture 7.7) |
| `apps/web/src/pages/BoardPage.tsx` | The board (default) and backlog views of `/projects/:key`; native HTML drag and drop plus keyboard moves; a live region |
| `apps/web/src/pages/CalendarPage.tsx` | The month grid, with navigation by `?month=` and dated issues in the workspace zone |
| `apps/web/src/calendar/month.ts` | Pure month arithmetic: the weeks of a month, Monday first, as local dates |

No server change is needed: `GET /issues` and `PATCH /issues/:key` already
cover both views, and the workspace time zone is in `GET /workspace`.

## Drag and drop

The tech stack names dnd-kit. This slice uses native HTML drag and drop
for the mouse, plus explicit keyboard controls, for two reasons. Native
drag alone has poor keyboard support (techstack section 2), so the
keyboard path is built separately and tested as the primary path. Adding
dnd-kit would also mean a new dependency and licence entry in Hein's area
just before his design work. DEC-019 records this; Hein can swap in dnd-kit
without changing the data path.

## Proposed dates

The tentative value is on disk while a change is pending. For an issue
with a pending `record.updateField` on `due` whose `after` equals the
current value, the accepted date is the change's `before`:

- the calendar shows the issue on the accepted date normally, and on the
  proposed date with a dashed "Proposed" marker;
- the board card shows "Due 5 Dec 2026 · proposed 3 Dec 2026";
- an edit to a due date that has a pending change shows the warning "A
  change to this date is awaiting review; saving replaces it". The
  existing rule then applies: the newer manual edit stands, and the
  pending change becomes a conflict when reviewed.

## Narrow screens

- **At or below 760 px,** the board's three columns stack in status
  order.
- **At or below 600 px,** the month grid becomes a list of the month's
  days: each row has the weekday, the date and its items. Empty days are
  compacted, and the weekday header is hidden. The DOM stays the same, so
  keyboard order matches.

## Self-review (Kiro, 2026-11-24)

- **Checked:**
  - every requirement maps to a module and a test in `tasks.md`;
  - no new endpoint or data file, so Hein's slice stays buildable against
    `docs/data-format.md`;
  - timed due dates are placed by the workspace zone, matching the
    scheduler.
- **Changed during review:**
  - The first plan put a status `<select>` on every card. It was kept
    only as the visible keyboard control. Alt+Arrow keys were added so
    that a keyboard user can move a card without leaving it.
  - Due dates are edited through one shared component, so both views
    write identical `due` values.
- **Residual risk:** native drag and drop does not work on touch screens;
  touch users use the status control. This is recorded for Hein.
