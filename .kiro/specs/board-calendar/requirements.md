# Requirements: B3 board and calendar, first slice

## Introduction

B3 gives projects a board with three columns, and gives the workspace a
month calendar of dated issues. Both read and write the same issue record.
This first slice was built by Kiro under Will's authorisation of
2026-11-24 (run 4).

**Hein owns B3 and the final visual identity.** This slice is functional
groundwork with placeholder styling. The parts left for him are marked
"handoff" in `tasks.md`.

- **Traces to:**
  - PRD-030 (board, backlog, issue detail);
  - PRD-031 (create and edit, status by drag and by keyboard, priority,
    due date);
  - PRD-032 (the board and the calendar share the record);
  - PRD-033 (the calendar; events are the handoff part);
  - PRD-001 (works with AI off), PRD-061 and D-C3 (proposed values are
    marked), and PRD-080 (keyboard and accessibility);
  - architecture sections 6 and 7.7.
- **Approval:** written and self-reviewed by Kiro under Will's
  authorisation. Human review is pending (Hein).

## Requirements

### Requirement 1: Board and backlog (PRD-030, PRD-031)

1. `/projects/:key` SHALL show a board with To do, In progress and Done
   columns by default, and the existing backlog list as a second view
   (`?view=backlog`).
2. Each card SHALL show the key, the title, the priority and the due date,
   and SHALL open the issue. A card with a change awaiting review SHALL be
   marked "Pending review".
3. The user SHALL be able to create an issue from the board. It SHALL
   appear in To do and open the issue page, as before.
4. The user SHALL be able to change a card's status:
   1. by dragging the card to another column;
   2. with the keyboard, using Alt+Left Arrow or Alt+Right Arrow on a
      focused card, or a labelled status control on the card.

   Each move SHALL be announced in a live region. A move SHALL be saved
   with the issue's field merge, so a newer edit to another field
   survives, and a conflicting status edit is reported, not overwritten.
5. The user SHALL be able to change a card's due date from the board.

### Requirement 2: Month calendar (PRD-032, PRD-033 in part)

1. `/calendar` SHALL show a month grid, Monday first, for the month in
   `?month=YYYY-MM`. It defaults to the current month in the workspace
   time zone. It SHALL offer Previous, Next and Today.
2. Each dated issue SHALL appear on its date in the workspace time zone:
   - an all-day `{ date }` on that date;
   - a `{ dateTime, timeZone }` on its local date in the workspace time
     zone.

   An issue SHALL open from the calendar.
3. The user SHALL be able to change an issue's due date from the calendar.
   A timed due date SHALL keep its local time when it moves to another
   day.
4. WHILE a due-date change awaits review, the calendar SHALL show the
   accepted date normally, and the proposed date marked "Proposed"
   (architecture 7.7). The board SHALL show the same distinction.

### Requirement 3: One record, both views (PRD-032)

1. A due-date edit made from either view SHALL update the same issue in
   `issues.json`, and SHALL show in both views, including after a
   restart.
2. Edits SHALL go through `PATCH /issues/:key` with `baseRevision` and
   `baseValues`, so the existing conflict handling applies.

### Requirement 4: Without AI, by keyboard, at narrow width (PRD-001, PRD-080)

1. Every journey above SHALL work with no provider configured.
2. Every journey above SHALL work with the keyboard alone.
3. At 390 px wide, the board columns SHALL stack and the month SHALL read
   as a list of days, with nothing cut off horizontally.

### Out of this slice (handoff to Hein)

- Calendar events: create, edit, delete and `calendar.json` (PRD-033).
- The agenda view (structure section 6).
- Ordering cards within a column (`rank`, fractional indexing).
- The final visual design, and an issue drawer on the board.
