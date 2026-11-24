# Backlog

This file lists incomplete work at milestone level only. Each milestone's
tasks live in its spec's `tasks.md`; do not copy them here. Move behaviour
to `FEATURES.md` once it has been verified. Requirement IDs refer to
`docs/PRD/structure.md` (`PRD-xxx`) and to the intake (`R-*`).

## P0: needed for submission (in order)

- [~] **W2 PRD and first spec.** Done: `docs/PRD/` is drafted and committed.
  Remaining: Will's review of the PRD and DEC-005 to DEC-010, then the B1
  spec through requirements, design and tasks. Owner: Will.
- [ ] **W4 Kiro development tooling.** Inventory, configure and smoke-test
  the Impeccable skill and Playwright MCP, and record the results (R-K1 to
  R-K4). Owner: Will.
- [ ] **A Wireframe** (R-D-A, PRD-010, PRD-080). Owner: Hein. Spec:
  `.kiro/specs/wireframe/` (not yet created).
- [ ] **B1 Workspace core** (PRD-002, PRD-003, PRD-067, PRD-070 to PRD-072).
  Owner: Will. Spec: `.kiro/specs/workspace-core/` (next).
- [ ] **B2 Notes** (PRD-020 to PRD-024). Owner: Will. Spec: not yet created.
- [ ] **B3 Board and calendar** (PRD-030 to PRD-033). Owner: Hein. Spec:
  not yet created.
- [ ] **B4 Reminders** (PRD-040 to PRD-044). Owner: Will. Spec: not yet
  created.
- [ ] **B5 Change journal and review UI with fixed operations** (PRD-060 to
  PRD-067). Owner: Will. Spec: not yet created.
- [ ] **Hook** to run the review and reversal tests when mutation code
  changes (R-K5). Add it once the B5 tests exist.
- [ ] **C Provider settings and read-only AI** (PRD-050 to PRD-055, PRD-074
  to PRD-076). Owner: Will. Spec: not yet created.
- [ ] **D Agent edits, correction and personalised reminders** (PRD-042,
  PRD-051, PRD-060 to PRD-066). Owner: Will. Spec: not yet created.
- [ ] **E Package, rehearse and submit** (PRD-073, PRD-090, R-V1 to R-V6).
  Owners: Will and Hein. Gate: `docs/submission-checklist.md`.

## P1: if time allows before 2 December

- [ ] Runtime MCP tool backed by the workspace service (R-S9).
- [ ] Bonus-prize entries (a decision for Will and Hein).

## P2: after the first release (R-J6, R-T4)

- [ ] Sprints, advanced reports, multi-user sync and integrations.
- [ ] Custom board columns, sub-tasks, attachments and comments.
- [ ] More providers beyond the verified routes.
- [ ] A visual graph view of notes and issues.
- [ ] Embeddings, only if representative questions show a retrieval gap
  (R-A5).
- [ ] Reminders that fire while the app is closed.
- [ ] Signed installers and macOS or Linux packages.
