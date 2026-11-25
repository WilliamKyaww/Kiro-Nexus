# Backlog

This file lists incomplete work at milestone level only. Each milestone's
tasks live in its spec's `tasks.md`; do not copy them here. Move behaviour
to `FEATURES.md` once it has been verified. Requirement IDs refer to
`docs/PRD/structure.md` (`PRD-xxx`) and to the intake (`R-*`).

Done on 24 November 2026 (see `FEATURES.md`), including the corrective
pass on `e61a3d4` and run 4:

- the PRD and its amendments;
- the B1 workspace core;
- B5 with fixed operations;
- the B2 search and outside-edits slice;
- the review hooks;
- the Impeccable and Playwright MCP checks;
- the four Phase 1 repairs;
- slice C read-only Ask, tested against the test double only;
- run 4: the Ask repairs, a first B3 slice and the first Edit journey,
  all tested against the test double only;
- run 5: the eleven repairs from the run-4 review, and B4 ordinary
  reminders.

## P0: needed for submission (in order)

- [~] **W4 Kiro development tooling.** Done: Impeccable is configured and
  verified, and the Playwright MCP server is verified over stdio.
  Remaining: a human must register Playwright MCP in Kiro
  (`docs/tooling.md`), then confirm that Kiro discovers it and run one tool
  call. Owner: Will.
- [ ] **A Wireframe, final design.** `wireframe/` now holds Kiro's design
  proposal (25 November, DEC-026), waiting for Will and then Hein.
  Hein owns the final visual identity (PRD-010, PRD-080). Owner: Hein.
- [~] **B2 Notes.** Done: section search, outside edits and draft
  protection (`.kiro/specs/notes-search-watch/`), and in run 6 the
  backlinks panel and `[[` completion (`.kiro/specs/backlinks-completion/`,
  DEC-030). Remaining: rename, move and delete in the UI, and the CodeMirror
  editor (PRD-020, PRD-021). Owner: Will.
- [~] **B3 Board and calendar** (PRD-030 to PRD-033). Owner: Hein. Spec:
  `.kiro/specs/board-calendar/`. Done (by Kiro in run 4): tasks 1 to 3,
  the board, the backlog view, status moves and the month view of dated
  issues. Remaining: task 4, Hein's handoff (calendar events, the agenda
  view, ordering within a column and the final design).
- [~] **B4 Reminders** (PRD-040 to PRD-044). Owner: Will. Spec:
  `.kiro/specs/reminders/`. Done (by Kiro in run 5): tasks 1 to 5, ordinary
  reminders in the browser and Electron. Remaining:
  - task 6, Hein's event writing and `?event=<id>`;
  - a look at a real Windows notification (STATE human action 9);
  - personalised wording (PRD-042, slice D).
- [~] **B5 Change journal.** Done: tasks 1 to 8 and 10 of
  `.kiro/specs/change-journal/`, and part of task 9 (`record.create`,
  `record.addLink` and the `dependsOn` cascade, in run 4). Remaining (the
  rest of task 9, with slice D): `note.create` and "Restore original" for
  an ambiguous conflict. Correction runs were built in run 6 (DEC-029).
- [~] **C Provider settings and read-only AI** (PRD-050 to PRD-055, PRD-074
  to PRD-076). Owner: Will. Spec: `.kiro/specs/ask-readonly/`. Done:
  tasks 1 to 4 and 7 to 9, and the corrective task 6, verified against the
  test double only. Remaining: task 5, the live check with a real free
  key, which closes Q1 only on exit 0. The team route (Q5, PRD-091) is
  proposed in `docs/judge-ai-route.md` but not decided or built.
- [~] **D Agent edits, correction and personalised reminders** (PRD-042,
  PRD-051, PRD-060 to PRD-066). Owner: Will. Started: the first Ask → Edit
  → Review journey (`.kiro/specs/edit-first-journey/`, tasks 1 to 4), and
  in run 6 the correction loop (task 5a, DEC-029), verified against the
  test double only. Remaining: task 5 (new notes, "Restore original" and a
  live Edit check), and personalised reminders. Not authorised yet.
- [ ] **E Package, rehearse and submit** (PRD-073, PRD-090 to PRD-092, R-V1
  to R-V6). Owners: Will and Hein. Gate: `docs/submission-checklist.md`.
  The licence is chosen: MIT (DEC-032).

## P1: if time allows before 2 December

- [ ] Runtime MCP tool backed by the workspace service (R-S9).
- [ ] Bonus-prize entries (a decision for Will and Hein).
- [ ] A dev server with hot reload. There is currently only build-and-serve.

## P2: after the first release (R-J6, R-T4)

- [ ] Sprints, advanced reports, multi-user sync and integrations.
- [ ] Custom board columns, sub-tasks, attachments and comments.
- [ ] More providers beyond the verified routes.
- [ ] A visual graph view of notes and issues.
- [ ] Embeddings, only if representative questions show a retrieval gap
  (R-A5).
- [ ] Reminders that fire while the app is closed.
- [ ] Signed installers and macOS or Linux packages.
