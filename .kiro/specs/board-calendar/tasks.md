# Implementation plan: B3 board and calendar

This is the only checklist for B3. B3 stays partially complete until
Hein's handoff tasks are done.

- [x] 1. Shared time helpers and the field mutation
  - **Verified by Kiro, 2026-11-24:**
    - `apps/web/src/calendar/month.test.ts` (3 tests): Monday-first weeks
      with padding, a month that starts on a Sunday, a leap February, and
      `zonedTimeToUtc`, `localDateOf` and `dueLocalDate` across the
      27–28 March 2027 clock change and a Tokyo workspace;
    - the scheduler and review tests still pass;
    - `useIssueField` sends `baseRevision` and `baseValues` (exercised by
      the task 2 test).
  - _Requirements: 2.2, 2.3_
- [x] 2. Board with the backlog kept, drag and keyboard moves, due dates on cards
  - **Verified by Kiro, 2026-11-24:** `tests/e2e/b3-board-calendar.spec.ts`
    "board: …", with AI off. It covers:
    - creating NEX-2 from the board, which opens it;
    - a drag to In progress;
    - Alt+Right Arrow to Done, with focus kept and the move announced, and
      the edge case "already in Done";
    - priority Urgent set on the issue page and shown on the card;
    - the due date changed from the card;
    - NEX-1 renamed in another tab, then moved by its status control from
      the older board: the title survives;
    - after a restart, every value shows; the backlog view is kept.

    `issues.json` was checked at each step.
  - _Requirements: 1, 3, 4_
- [x] 3. Month calendar with due-date edits and proposed markers
  - **Verified by Kiro, 2026-11-24:** the same spec. It covers:
    - "calendar: …": NEX-1 on 5 December; moved to 8 December from the
      calendar using the keyboard (Enter to open, Enter to save); the
      card shows 8 December; moved to 12 December from the card, and the
      calendar follows; both kept after a restart; month navigation; with
      the fixed demo applied, 12 December shows normally and 3 December
      shows "Proposed", and the card says "Due 12 Dec 2026 · proposed
      3 Dec 2026" and "Pending review".
    - "narrow 390 × 844": no horizontal overflow on either page; the month
      reads as a list ("Saturday 5 December"); the columns stack; a
      keyboard move still works.
    - Screenshots inspected at 1360 × 900 and 390 px. That inspection
      found the date editor overflowing the Saturday cell, and it now
      floats over the grid.
  - _Requirements: 2, 3, 4_
- [ ] 4. Handoff to Hein (not started, his slice)
  - [ ] 4.1 Calendar events: `calendar.json`, create, edit and delete
    (PRD-033), and events on the month grid.
  - [ ] 4.2 The agenda view.
  - [ ] 4.3 Ordering within a column (`rank`, fractional indexing), and
    dnd-kit if he wants it (DEC-019).
  - [ ] 4.4 The final visual design of the board and the calendar, and the
    issue drawer. Today's styling is a placeholder; the classes are under
    "Board and calendar" in `apps/web/src/styles.css`.
