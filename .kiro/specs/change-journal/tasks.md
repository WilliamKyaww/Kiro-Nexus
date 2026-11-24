# Implementation plan: B5 change journal

This is the only checklist for B5. Tick a task only after its acceptance
condition has been seen to pass.

Tasks 1 to 8 were verified by Kiro on 2026-11-24 (evidence: `FEATURES.md`). No
human review has happened yet. Task 9 is deliberately left open for slice D.

- [x] 1. Journal schema and pure span and record logic
  - **Acceptance:**
    - Unit tests show that a span is located uniquely, that context
      disambiguates repeated spans, and that a missing or ambiguous span is
      reported.
    - Property tests (fast-check) hold for round trip, isolation and
      surviving unrelated edits.
  - _Requirements: 3.2, 3.4_

- [x] 2. ReviewEngine: propose and apply
  - **Acceptance:** integration tests show that:
    - invalid operations write nothing;
    - the journal file exists before the first workspace write, which is
      checked with a fault injected at the first write;
    - a repeated `opId` is not applied twice;
    - a note change and an issue change land in their real files.
  - _Requirements: 1.1–1.4, 2.1, 7.1_

- [x] 3. Accept, reject, keep-current, feedback
  - **Acceptance:** an integration test runs the following across two
    files, checking the actual file bytes:
    1. Accept the note change and reject the date change. Only the date is
       reversed.
    2. A manual edit elsewhere in the note survives rejecting a note
       change.
    3. Rejecting an edited span gives `conflicted` (`missing`), and the
       newer text is kept.
    4. A duplicated span with identical neighbours gives `conflicted`
       (`ambiguous`), and nothing is written.
    5. Repeated accept and reject calls are no-ops.
  - _Requirements: 3.1–3.5, 4.2_

- [x] 4. Recovery after a crash during apply and during rejection
  - **Acceptance:** real service processes are killed at injected points
    (`NEXUS_FAULT`), after the journal write and after the first of two
    file writes. On restart the run is rolled forward, the files match the
    `afterHash` values, and the changes are `pending`.
    - A crash after the reversal is journaled but before the file write is
      completed to `rejected` on restart.
    - A file changed externally while the service was down becomes
      `conflicted` with nothing overwritten.
  - _Requirements: 5.1–5.2_

- [x] 5. Pending date does not trigger a reminder
  - **Acceptance:** a unit test shows that `dueReminders` does not include a
    reminder for a pending due date, and does include it after accept.
  - _Requirements: 6.1_

- [x] 6. HTTP routes and the fixed demo operations
  - **Acceptance:** the integration tests over HTTP run demo, list open,
    accept, reject and feedback. The demo is labelled `fixed-demo`.
  - _Requirements: 1–4, 7.1_

- [x] 7. Review UI (bar, markers, feedback) and browser E2E
  - **Acceptance:** a Playwright journey on a copy of the sample:
    1. Apply the demo. The note opens with a highlighted "Pending review"
       list item.
    2. Next opens `NEX-1` with the due-date field marked.
    3. Accept the note change, reject the date and give a reason.
    4. Restart the service. The review bar shows no pending changes.
    5. The note file contains `- [x] Hein builds the calendar view`, and
       `issues.json` has `due` 2026-12-05.

    A second run with reduced motion shows the static outline.
  - _Requirements: 2.2–2.4, 3, 4.1_

- [x] 8. Kiro hook for the focused review and reversal tests
  - **Acceptance:** `.kiro/hooks/` contains the hook. An edit to
    `server/src/review/**` fires it, and it records a pass or fail line in
    `.tmp/hooks/review-tests.log`. If the hook cannot fire in this session,
    the script is verified by hand and the hook marked unverified.
  - _Requirements: R-K5_

- [x] 10. Partial runs: honest outcomes, Retry and Discard (Phase 1 repair 1; added 2026-11-24)
  - **Defect, reproduced on `2310608`:** the note write succeeded and the
    issue write failed, but the UI said "Applied 2". The date on disk never
    changed, and after a restart a repeated demo said "already applied".
  - **Acceptance:** `partial.test.ts` (7 tests, reading real files and the
    journal), plus the real-process test in `review-http.test.ts`, show
    that:
    - each file's outcome is reported;
    - a restart writes nothing without being asked, and a repeat reports
      the failure;
    - Retry writes only the outstanding file, keeps an unrelated manual
      edit, conflicts on a same-field edit, and repeating it is a no-op;
    - Discard preserves the file and the written sibling change;
    - when the first file fails, the later files are "not attempted".

    The E2E test `b5-review.spec.ts` covers a failed issue write, a
    restart, then Retry.
  - _Requirements: 1.3, 2.1, 3.5, 5.1; architecture section 7.3_

- [ ] 9. Deferred to slice D (not tonight)
  - `record.create`, `note.create`, `dependsOn` cascade, correction runs
    with `supersedes`, and "Restore original" for ambiguous conflicts.
