# Backlog

This file lists incomplete work at milestone level only. Each milestone's
tasks live in its spec's `tasks.md`; do not copy them here. Move behaviour
to `FEATURES.md` once it has been verified. Requirement IDs refer to
`docs/PRD/structure.md` (`PRD-xxx`) and to the intake (`R-*`).

Done on 24 November 2026 (see `FEATURES.md`):

- the PRD and its amendments;
- the B1 workspace core;
- B5 with fixed operations;
- the B2 search and outside-edits slice;
- the review hooks;
- the Impeccable and Playwright MCP checks;
- the four Phase 1 repairs;
- slice C read-only Ask, tested against the test double only.

## P0: needed for submission (in order)

- [~] **W4 Kiro development tooling.** Done: Impeccable is configured and
  verified, and the Playwright MCP server is verified over stdio.
  Remaining: a human must register Playwright MCP in Kiro
  (`docs/tooling.md`), then confirm that Kiro discovers it and run one tool
  call. Owner: Will.
- [ ] **A Wireframe, final design.** A brief prototype is in `wireframe/`.
  Hein owns the final visual identity (PRD-010, PRD-080). Owner: Hein.
- [~] **B2 Notes.** Done: section search, outside edits and draft
  protection (`.kiro/specs/notes-search-watch/`). Remaining: rename, move
  and delete in the UI, the CodeMirror editor, the backlinks panel and the
  `[[wikilink]]` autocomplete (PRD-020, PRD-021). Owner: Will. Spec: not
  yet written.
- [ ] **B3 Board and calendar** (PRD-030 to PRD-033). Owner: Hein. Build it
  against the issue shape in `docs/data-format.md` and the review states in
  `packages/schema/src/review.ts`. Spec: not yet written.
- [ ] **B4 Reminders** (PRD-040 to PRD-044). Owner: Will. The
  accepted-values seam (`server/src/scheduler/reminders.ts`) and the dedup
  key already exist. Spec: not yet written.
- [~] **B5 Change journal.** Done: tasks 1 to 8 of
  `.kiro/specs/change-journal/`. Remaining (task 9, with slice D):
  `record.create`, `note.create`, the `dependsOn` cascade, correction runs
  and "Restore original" for an ambiguous conflict.
- [~] **C Provider settings and read-only AI** (PRD-050 to PRD-055, PRD-074
  to PRD-076). Owner: Will. Spec: `.kiro/specs/ask-readonly/`. Done:
  tasks 1 to 4, verified against the test double only. Remaining: task 5,
  the live check with a real free key, which closes Q1 if it passes. The
  team route (Q5, PRD-091) is proposed in `docs/judge-ai-route.md` but not
  decided or built.
- [ ] **D Agent edits, correction and personalised reminders** (PRD-042,
  PRD-051, PRD-060 to PRD-066). Owner: Will. Spec: not yet written.
- [ ] **E Package, rehearse and submit** (PRD-073, PRD-090 to PRD-092, R-V1
  to R-V6). Owners: Will and Hein. Gate: `docs/submission-checklist.md`.
  This includes choosing an open-source licence.

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
