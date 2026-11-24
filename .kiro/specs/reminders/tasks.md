# Implementation plan: B4 ordinary reminders

This is the only checklist for B4. Every check below used the test clock, the
fictional sample and no AI.

- [x] 1. Occurrences, settings and the delivery log
  - **Verified by Kiro, 2026-11-24:** `server/src/scheduler/reminders.test.ts`
    (4 tests). They cover 09:00 across the 28 March 2027 clock change in
    London, a London deadline in a Tokyo workspace, the settings' time,
    done and undated issues, and events, including one with its reminder
    off. `engine.test.ts` still shows that a pending date is not reminded
    (PRD-066).
  - _Requirements: 1, 2.1, 5.1_
- [x] 2. The scheduler and the test clock
  - **Verified by Kiro, 2026-11-24:**
    - `server/src/scheduler/scheduler.test.ts` (6 tests):
      - a proposed date passes with no delivery;
      - accepted and manual dates;
      - one delivery, whatever the number of ticks;
      - a missed reminder recorded once, and not again on the next start;
      - a crash's `delivering` entry becomes missed;
      - a synthetic event;
      - new settings, and reminders turned off;
      - the test reminder.
    - `scheduler-http.test.ts` (3 tests, real process):
      - `NEXUS_FAULT=scheduler:after-delivering` exits 86, and the restart
        lists the reminder as missed and delivers nothing;
      - a browser session cannot move the clock;
      - the route does not exist without `NEXUS_TEST_CLOCK`.
  - _Requirements: 1.3 to 1.6, 2, 3, 6.1_
- [x] 3. API and the browser surfaces
  - **Verified by Kiro, 2026-11-24:** `tests/e2e/b4-reminders.spec.ts`, "J4"
    and "Settings…". Screenshots at 1360 × 900 and 390 × 844 were inspected.
    At 390 px, two stacked notifications covered the rail, so a narrow
    screen now shows only the newest one, at the bottom.
  - _Requirements: 4.1, 4.3 to 4.6, 5_
- [x] 4. Electron native notifications
  - **Verified by Kiro, 2026-11-24:** `b4-reminders.spec.ts` "Electron…".
    - **Granted:** main records the native notification for the delivered ID,
      with the title "Reminder: NEX-1". A simulated click opens NEX-1.
    - **Denied** (`NEXUS_NATIVE_NOTIFICATIONS=denied`): no native
      notification; the in-app one still appears; Notifications says why.
    - **Simulated, not observed:** the operating system's toast and its
      click. The test records the call instead of showing a Windows
      notification, and emits the click event. The preload's new
      `onNavigate` passes only reminder paths (`b1-electron.spec.ts`).
  - _Requirements: 4.2, 4.3, 6.2_
- [x] 5. End-to-end evidence
  - **Verified by Kiro, 2026-11-24:** `b4-reminders.spec.ts` (3 tests, 9 of 9
    with `--repeat-each=3`). The J4 test covers:
    1. a date set on the board by keyboard;
    2. a date proposed for review passing 09:00 with no delivery;
    3. the accepted 4 December delivered once, with three more ticks
       delivering nothing, as the log on disk shows;
    4. both tabs showing the one delivery;
    5. **Open** by keyboard, reaching `/issues/NEX-1?id=…`;
    6. the badge cleared once seen;
    7. the labelled test reminder;
    8. a restart showing "While you were away" once, with no new notification;
    9. a second restart with no summary.
  - _Requirements: 6_
- [ ] 6. Handoff to Hein (not this slice)
  - Event writing, `?event=<id>` on the calendar, and click-through on a real
    event, which is outstanding until his event service exists (design,
    "Event integration points for Hein"). An event reminder currently opens
    its month.
