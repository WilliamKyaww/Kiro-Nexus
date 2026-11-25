# Implementation plan: the first Ask → Edit → Review journey

This is the only checklist for this slice. Task 5a, the correction loop of
J7 (the rejected date, the reason and the correction run), was authorised
in run 6 stage 3. The other items of task 5 are still not authorised.

- [x] 1. Journal support for new issues, new links and dependencies
  - `record.create` and `record.addLink`, `{{issue:<ref>}}` references,
    `dependsOn` from references, `accept` with dependencies, `reject` with
    dependents, and reversal that keeps newer work.
  - **Verified by Kiro, 2026-11-24:** `server/src/review/create.test.ts`
    (6 tests: real files, the journal, a restart, and a crash after the
    journal write). The existing review tests still pass.
  - _Requirements: 2.3, 2.4, 2.6, 3.4 to 3.7_
- [x] 2. Edit authority and `propose_changes` in the coordinator and the routes
  - **Verified by Kiro, 2026-11-24:** `server/src/ask/edit.test.ts`
    (6 tests): the three pending changes and their dependencies; Ask
    excludes a pending issue until it is accepted; the write tool is never
    offered to Ask, and a write attempt is refused; Edit is refused
    without tool calling, before any request; an invalid proposal writes
    nothing; base values come from the workspace.
  - _Requirements: 1.2 to 1.4, 2.1, 2.2, 2.5_
- [x] 3. Composer, Edit card, dependency confirmation and highlighting
  - **Verified by Kiro, 2026-11-24:** the two browser tests in task 4, and
    screenshots at 1360 × 900 and 390 × 844. Inspecting the screenshots
    found doubled quotation marks in the confirmation, which was then
    reworded.
  - _Requirements: 1.1, 3.1 to 3.3, 3.8_
- [x] 4. End-to-end proof with the labelled test double
  - **Verified by Kiro, 2026-11-24:** `tests/e2e/c5-edit-journey.spec.ts`
    (2 tests):
    - **Journey.** The kickoff answer, then Edit. The note line opens
      focused and highlighted. Accept prompts "Accept both". The link is
      highlighted on NEX-2 and accepted. The journal shows all three
      changes accepted. The conversation shows the outcomes. A later Ask
      in the same conversation finds NEX-2 and leaves the files' hashes
      unchanged.
    - **Rejection.** A manual edit to the same note, then a restart while
      the changes are pending. Rejecting the new issue lists both
      dependents. Cancel changes nothing. **Reject all 3** restores the
      note line and removes NEX-2, and the manual edit stays.
  - _Requirements: 3, 4.1_
- [x] 6. Repairs from the review of run 4 (run 5 stage 1)
  - The findings are R4-1 (wrong section), R4-2 (overlapping proposals),
    R4-3 (an accept without its prerequisite), R4-6 (workspace binding),
    R4-7 (key reuse) and R4-9 (cross-run references and interrupted group
    decisions). They are recorded, with their resolution, in
    `docs/reviews/2026-11-24-run4-review.md`. The design is in DEC-022.
  - **Verified by Kiro, 2026-11-24:**
    - `server/src/review/repairs.test.ts` (12 tests);
    - `server/src/ask/edit-http.test.ts` (1 test, real service);
    - `create.test.ts`, updated: NEX-3 follows a rejected NEX-2;
    - `tests/e2e/r5-repairs.spec.ts` "R4-3" and "R4-7".

    Each new test fails on an export of `251188e` and passes after the
    repair.
  - **Also:** a failed Edit turn offers **Retry Edit**, which asks first
    when the turn already proposed changes.
  - _Requirements: 2.2, 2.4, 2.5, 3.4 to 3.7_
- [x] 5a. The correction loop (Requirement 5, run 6 stage 3)
  - Engine: `correction` on the change, `beginCorrection`, `endCorrection`,
    `dropCorrection`, `propose` with `supersedes`, and recovery.
  - Routes and the correction run: feedback, retry and drop; the scope check;
    the correction prompt; the double's date rules.
  - Review bar: preparing, failed and empty corrections with Retry and Keep it
    rejected; opening the corrected change on its target.
  - Evidence: `correction.test.ts`, `correction-http.test.ts` and
    `j7-correction.spec.ts`.
  - **Verified by Kiro, 2026-11-25,** with the test double only:
    `correction.test.ts` (5 tests), `correction-http.test.ts` (7, real service)
    and `j7-correction.spec.ts` (2, Edge). Live Edit corrections are unverified.
  - _Requirements: 5.1 to 5.9, 4.1_
- [ ] 5. Not in this slice: other operations
  - New notes and block insertions.
  - "Restore original" for ambiguous conflicts.
  - A live check of Edit with a real free provider (Requirement 4.2).
