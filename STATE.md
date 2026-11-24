# State

- **Date updated:** 2026-11-24, at the end of the overnight run
- **Active phase:** waiting for Will's morning review of the overnight run
  (milestones A to D are complete)
- **Active spec:** none in progress. The next candidates are B3 (Hein), and
  B4 or C (Will).
- **PRD:** approved by Will at `7b775cd`, with amendments 1 to 4 (DEC-011
  to DEC-014).

## Authorisation

- **Standing:** local milestone commits under DEC-004. Stage only the
  relevant files by name, review the staged diff, add no AI trailers, report
  the short hash, and never push.
- **Overnight authorisation of 2026-11-24:** this covered milestones A to D
  and is now **spent**. Will's next instruction sets the next scope. Until
  then, a fresh session may only:
  - fix a failing check in existing work;
  - update documentation;
  - make the human-action steps below easier.
- **Not authorised:**
  - remote Git actions, publication, deployments, account changes and paid
    services;
  - system-wide installs;
  - provider credentials.

## Milestone log (overnight)

| Milestone | Status | Commit | Evidence |
| --- | --- | --- | --- |
| A. PRD amendments, B1 spec, W4 tools, wireframe | Done | `9b5b23a` | Kiro self-reviewed the B1 spec. Impeccable detect returned `[]` after one fix, and its renders were checked. The Playwright MCP stdio smoke test passed 6 of 6 |
| B. B1 workspace core | Done | `beb2b68` | Tests passed (38 unit and integration, 4 E2E). Manual runs of `try`, `open`, `stop` and `desktop` behaved as documented |
| C. B5 change journal and review UI | Done | `556b1ca` | Tests passed (64 unit and integration, 6 E2E). Real crash recovery, property tests and a mutation check passed. The Kiro hooks fire and record PASS or FAIL |
| D. B2 search and outside edits | Done | see `git log` (`feat: B2 section search and safe outside edits`) | 71 unit and integration tests, stable across 3 runs. 8 E2E tests, 24 of 24 across 3 repeats |

Every check above was run by Kiro. **No human review has happened yet.**

## Human actions pending

1. **Register Playwright MCP in Kiro.** Kiro's policy blocks agent writes to
   `.kiro/settings/`. The exact steps and JSON are in `docs/tooling.md`.
   Then confirm that Kiro discovers the server, and run one tool call.
2. **Final rules recheck before submission** (`docs/submission-checklist.md`).
3. **Choose an open-source licence** (the README says "to be chosen").

## Assumptions to check

| # | Assumption (Kiro's) | For |
| --- | --- | --- |
| 1 | A single root package with path aliases replaces npm workspaces (techstack section 1) | Will |
| 2 | B1 and B2 use a `<textarea>` editor, with CodeMirror still in the B2 backlog | Will, Hein |
| 3 | The web UI takes a typed folder path, because browsers have no native picker. Electron has **Browse…** | Hein |
| 4 | The palette and layout of the wireframe and app are placeholders. Hein owns the final identity | Hein |
| 5 | Impeccable telemetry is left on globally and disabled per call. Decide whether to run `npx impeccable telemetry off` | Will |
| 6 | The E2E tests use the system Microsoft Edge (`channel: msedge`), with no Playwright browser download | Hein |
| 7 | TypeScript 7.0.2 is used only for type checking. esbuild and Vite transpile | Will |
| 8 | The browser and desktop routes share the `npm run try` workspace, so running both shows the lock message, which is intended | Will |
| 9 | For a field with an unsettled change, reminders use its `before` value only while the field still holds the proposed value. A newer manual edit stands (B5 design) | Will |
| 10 | Agent edits fire both review hooks (tool and save), so the 3-second test run happens twice | Will |
| 11 | "Overwrite with mine" after an outside edit replaces the outside text without merging. The user chooses it after comparing | Will, Hein |

## Blockers and risks

- **Blocker:** none for the existing work.
- **Risk:** the free model route is unverified (Q1), and the team evaluation
  route is still open (Q5, PRD-091). Both are for slice C.
- **Dates:** Kiro credit requests close on 1 December at 20:00 GMT. The
  feature freeze is on 2 December. Submission closes on 4 December at
  22:00 GMT.

## Next action

- **Will:** review the overnight work using the README walkthrough. Then
  either authorise slice C (provider settings and read-only AI, which first
  needs the Q1 and Q5 decisions) or B4 (reminders).
- **Hein:** write and run the B3 board and calendar spec against
  `docs/data-format.md` and the review states in
  `packages/schema/src/review.ts`.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md`, this file, `BACKLOG.md` and `FEATURES.md`. The overnight
> authorisation is spent, so do not start a new slice until Will or Hein
> names one. To check that everything still works, run
> `npm run typecheck`, `npm test` and `npm run test:e2e`. The expected
> totals are 71 and 8 passing. When a slice is authorised:
>
> 1. Write its native spec under `.kiro/specs/<slice>/`.
> 2. Follow the working loop in `AGENTS.md`.
> 3. Commit each verified milestone locally under DEC-004, and never push.
