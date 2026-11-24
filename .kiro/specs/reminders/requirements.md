# Requirements: B4 ordinary reminders

## Introduction

Nexus reminds the user of dated issues and calendar events while it is running, in the
browser and in the desktop app, with AI switched off (journey J4). Each reminder is
delivered at most once, from accepted data only, and opens the item it is about. Missed
reminders are summarised once when Nexus reopens.

Will authorised this slice on 2026-11-24 as stage 2 of run 5. Personalised wording
(PRD-042, J10) is slice D. Hein keeps event creation, editing and deletion, the agenda,
card ordering and the final design. This slice reads the shared event record and
delivers its reminders.

- **Traces to:**
  - PRD-040: ordinary reminders open the item;
  - PRD-041: the scheduler owns timing, zones and duplicate prevention;
  - PRD-043: in-app and native delivery, only while running, with a missed summary;
  - PRD-044: the test reminder;
  - PRD-066: pending dates never trigger reminders;
  - journey J4;
  - architecture sections 6, 7.7 and 8;
  - DEC-009 and DEC-023.
- **Approval:** written and self-reviewed by Kiro under Will's authorisation (run 5).
  Human review is pending.

## Requirements

### Requirement 1: What is reminded, and when

1. Each issue that is not done and has an accepted due date SHALL have one reminder:
   - for an all-day date, at the time set in Settings on that date in the workspace
     zone (09:00 by default);
   - for a timed due date, the number of minutes set in Settings before it (60 by
     default).
2. Each calendar event in `.nexus/calendar.json` SHALL have one reminder by the same
   rules, using its start.
3. Reminders SHALL use accepted values only. A date awaiting review, and an issue
   awaiting review, SHALL never trigger one (PRD-066).
4. Accepting a date, or editing one by hand, SHALL reschedule its reminder without a
   restart.
5. An all-day reminder SHALL follow the workspace zone across a clock change. A timed
   reminder SHALL be its deadline's instant minus the offset.
6. Turning reminders off in Settings SHALL stop new deliveries. The test reminder
   SHALL still work.

### Requirement 2: At most once (DEC-009)

1. Each occurrence SHALL have a key made of the target, the rule and the scheduled
   instant.
2. The scheduler SHALL record `delivering` in `.nexus/state/deliveries.json` before it
   shows the reminder, and `delivered` after.
3. Repeated ticks, several open tabs and a restart SHALL never deliver one occurrence
   twice. All surfaces SHALL share one delivery record.
4. An entry left at `delivering` by a crash SHALL become `missed` on restart, and
   SHALL NOT be shown as a new reminder.

### Requirement 3: Only while running, and missed reminders

1. Reminders SHALL be delivered only while the service is running and has the
   workspace open.
2. On reopening, each occurrence whose time passed while Nexus was closed SHALL be
   recorded as missed. Missed reminders SHALL be shown once, as "While you were away",
   for that session.
3. Reopening again SHALL neither repeat the summary nor show the old reminder.
4. The Notifications screen SHALL explain that reminders are delivered only while
   Nexus is running.

### Requirement 4: Surfaces

1. **In-app.** In the browser and in the desktop app, a delivered reminder SHALL appear
   as an in-app notification and in the Notifications list. The rail SHALL show how
   many are unseen.
2. **Native.** In the desktop app, when native notifications are available and turned
   on, the same delivery SHALL also appear as a native notification. When they are
   unavailable or denied, the in-app route SHALL still work, and Notifications and
   Settings SHALL say why.
3. **Opening.** Clicking a reminder, in-app or native, SHALL open the exact item.
   - An issue opens by key, checked against its ID.
   - An event opens the calendar at its month.
4. **Old reminders.** An old reminder SHALL still identify its item, or say that it is
   gone.
5. **Another workspace.** A reminder from a workspace that is no longer open SHALL say
   so rather than open anything.
6. **Keyboard.** Every control SHALL work by keyboard, and the in-app notification
   SHALL be announced politely.

### Requirement 5: Settings and the test reminder

1. Settings SHALL offer:
   - reminders on or off;
   - the time of day for all-day dates;
   - the offset before timed due dates;
   - native notifications on or off (desktop).

   They are saved in `.nexus/reminders.json`.
2. **Send test reminder** SHALL deliver a reminder titled "Test reminder" at once,
   labelled as a test, through every surface. It opens the first issue, or the
   Notifications screen when there is none.

### Requirement 6: Evidence

1. A controlled clock, available only to the process that started the service, SHALL
   drive the tests:
   - a pending date's time passes with no delivery;
   - an accepted date gives one delivery, which opens the issue;
   - repeated ticks, a restart and a crash between intent and confirmation deliver
     nothing twice;
   - a missed reminder appears once.
2. The browser and Electron delivery paths SHALL be tested. The record SHALL say which
   native behaviour was observed and which was simulated.
3. Event reminders SHALL be tested against a synthetic event in `.nexus/calendar.json`
   until Hein's event service exists. Click-through on a real event is outstanding
   until then.
