# Design: B4 ordinary reminders

## Overview

```
WorkspaceService ── change events ─┐
ReviewEngine.unsettledChanges ─────┤
Clock (real, or the test clock) ───┼─► Scheduler (one per open workspace; tick every 30 s and on change)
.nexus/reminders.json (settings) ──┤     occurrences in (lastTickAt, now], accepted values only
.nexus/calendar.json (events) ─────┘     │
                                         ├─► .nexus/state/deliveries.json  delivering → delivered | missed
                                         └─► state.publish({ type: "notification", delivery })
                                                ├─► SSE → every tab: in-app notification, list, badge
                                                └─► Electron utilityProcess port → main → native Notification
```

## Data (documented in `docs/data-format.md`)

- **`.nexus/reminders.json`** is user data:
  `{ schemaVersion: 1, enabled, allDayTime: "HH:MM", timedOffsetMinutes, nativeNotifications }`.
  It is created with the defaults when Settings first saves.
- **`.nexus/state/deliveries.json`**:
  `{ schemaVersion: 1, seenUpTo, deliveries: [Delivery] }`. Each `Delivery` has:
  - `id` (`dlv_…`), `key`, `kind` (`issue`, `event` or `test`);
  - `targetId`, `targetKey`, `title`, `workspaceId`, `rule`;
  - `scheduledAt`, `status` (`delivering`, `delivered` or `missed`), `deliveredAt`;
  - `batch`: the start-up a missed entry was recorded in.

  Entries older than 60 days are pruned beyond the newest 500. Pruning records the
  latest pruned instant as `prunedUpTo`, and nothing at or before it is delivered or
  recorded again, so a clock set back cannot deliver a pruned key a second time (run 6,
  R5-6). Only a missing log means first use; a damaged one stops delivery until the user
  repairs or replaces it (R5-5).
- **`.nexus/state/scheduler.json`**: `{ schemaVersion: 1, lastTickAt }`, written by
  each tick. It marks the end of the period in which Nexus was running.
- **`.nexus/calendar.json`** is the shared event record. Hein owns its writing. This
  slice only reads it:
  `{ schemaVersion: 1, events: [{ id: "evt_…", title, start: Due, end?: Due, reminder?: boolean }] }`.
  A missing file means there are no events. A file that is not valid is reported in
  the log and skipped.

All of these go through `WorkspaceService` with atomic writes. `state/` is not synced
data (architecture section 3).

## Occurrences (`server/src/scheduler/reminders.ts`)

`occurrences(issues, events, settings, timeZone)` gives one occurrence per target:

| Target | Instant | Rule ID |
| --- | --- | --- |
| All-day `{ date }` | `zonedTimeToUtcChecked(date, allDayTime, timeZone)` | `allday-HHMM` |
| Timed `{ dateTime }` | `dateTime − timedOffsetMinutes` | `before-<N>m` |

- The key is `<kind>:<targetId>:<rule>:<instant>` (DEC-009).
- Changing the settings changes the rule. Occurrences under the new rule are new, and
  past ones are not repeated, because they fall before `lastTickAt`.
- Issues come from `effectiveAcceptedIssues`, so pending creates, pending dates and
  pending links are excluded (architecture 7.7). Done issues are skipped.

## The scheduler (`server/src/scheduler/scheduler.ts`)

- **Start** (on workspace open, after review recovery):
  1. Load the log.
  2. Mark every `delivering` entry as `missed`, in this start-up's batch.
  3. Record each occurrence in `(lastTickAt, now]` with no entry as `missed`, in the
     batch. These came due while Nexus was closed.
  4. Set `lastTickAt = now`.

  On a first start, with no `lastTickAt`, nothing counts as missed.
- **Tick** (every 30 s, after a data change debounced by 250 ms, and on demand from
  the test clock):
  1. For each occurrence in `(lastTickAt, now]` with no entry, write `delivering`.
  2. Publish it, and write `delivered`.
  3. Advance `lastTickAt`.

  Ticks are serialised, so two can never deliver the same key.
- **Fault points:** `scheduler:after-delivering` (a crash between intent and
  confirmation) and `scheduler:tick`.
- **Workspace switch.** The scheduler belongs to one service instance. `onClose` stops
  it, and each event carries its `workspaceId`.

## Clock

- The real clock is used by default.
- `NEXUS_TEST_CLOCK=<ISO instant>` starts the service with a frozen clock at that
  instant. It also enables `POST /api/v1/control/clock { now }`, which sets the clock
  and runs a tick, returning the deliveries made. The route needs the control secret,
  like `/shutdown`, and does not exist without the variable.
- The browser never sees the control secret.

## API

| Route | Effect |
| --- | --- |
| `GET /api/v1/notifications` | Deliveries, newest first (up to 200); `away` (this start-up's missed batch); `unseen`; `native` (desktop status); `settings` |
| `GET /api/v1/notifications/:id` | One delivery, for opening an old reminder |
| `POST /api/v1/notifications/seen` | Sets `seenUpTo`, which clears the badge in every tab |
| `GET` and `PUT /api/v1/reminders/settings` | Reminder settings (validated) |
| `POST /api/v1/reminders/test` | Delivers "Test reminder" at once |
| `GET /api/v1/reminders/due?at=` | Kept: a read-only preview |

## Surfaces

- **SSE.** An event `{ type: "notification", delivery }` goes to every tab:
  - the shell shows an in-app notification for 12 s, in an `aria-live="polite"`
    region, with **Open** and **Dismiss**;
  - it refreshes the list and the badge.
- **Opening.** Every surface opens `/notifications/open?id=<deliveryId>&ws=<workspaceId>`.
  The page loads the delivery from the open workspace:
  - if `ws` is a different workspace, it says so;
  - if the delivery is unknown, it says the reminder is gone;
  - otherwise it navigates to `/issues/<key>?id=<issueId>` (the issue page checks the
    ID, R4-7), to the calendar month for an event, or to Notifications for a test with
    no issue.
- **Electron.**
  - The service posts `{ type: "notification", delivery, native }` on its
    `utilityProcess` port.
  - Main shows a native `Notification` when it is supported, not denied, and turned on.
    `NEXUS_NATIVE_NOTIFICATIONS=denied` simulates a denial.
  - A click focuses the window and sends `nexus:navigate` with the open path. The
    preload exposes `onNavigate`. Main checks that the path starts with
    `/notifications/open?`.
  - At start-up, main tells the service the native status.
  - For tests, `NEXUS_E2E_NOTIFY_LOG=<file>` appends each native notification to that
    file, and `app.emit("nexus:test-notification-click", id)` runs the click handler.
    This simulates the operating system's click. The OS toast itself is not observed.

## Event integration points for Hein

1. Write `.nexus/calendar.json` through `WorkspaceService`, in the shape above. The
   scheduler reloads it on its change event.
2. Give the calendar a way to show `?event=<id>` (scroll to it and focus it). Until
   then, an event reminder opens its month.
3. `start` uses the same `Due` shape as issues, so the rules and DEC-023 apply
   unchanged.
4. `reminder: false` turns off an event's reminder.

## Testing

- **`reminders.test.ts`:** the rules across the 28 March 2027 clock change (London) and
  in a Tokyo workspace; the settings; a pending date; a pending create; a done issue;
  events.
- **`scheduler.test.ts`** (the test clock in-process), covering:
  - a pending date passes with no delivery;
  - an accepted date gives one delivery;
  - repeated ticks deliver nothing more;
  - a restart gives a missed batch once;
  - a second restart gives no summary;
  - a synthetic event;
  - settings changes;
  - reminders turned off.
- **`scheduler-http.test.ts`** (a real process): a crash between `delivering` and
  `delivered` (`NEXUS_FAULT`) becomes missed and is not shown again; the control route
  is absent without the variable.
- **`tests/e2e/b4-reminders.spec.ts`**:
  - the browser journey: a date set on the board, a proposed date passing with no
    delivery, a future date accepted, one notification that opens the issue, two tabs,
    a restart, missed once, the test reminder and the keyboard;
  - Electron: native delivery and click, both simulated as described, and the denied
    path using in-app delivery only.
