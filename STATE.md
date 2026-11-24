# State

- **Date updated:** 2026-11-24
- **Active phase:** Work item 2, PRD and first Kiro spec (not started)
- **Previous phase:** Work item 1, engineering workflow and product intake
  (complete, uncommitted)
- **Active spec:** none yet

## Authorised scope

- Local edits inside this checkout only.
- **Git:** not authorised. Leave every change uncommitted until Will asks
  for a specific Git action.
- **Not authorised:** dependency installation, product scaffolding, MCP,
  skill or hook configuration (work item 4), publication and submission.

## Blockers and risks

- **Blocker:** none.
- **Risk:** Kiro's fetcher cannot read the live Devpost pages (HTTP 403). The
  saved copy is the local reference. Codex checked the key requirements
  against the live rules on 24 November 2026 (reported by Will). The final
  recheck is on `docs/submission-checklist.md`.
- **Deadline:** Kiro credit requests close on 1 December 2026 at 20:00 GMT.
  Feature freeze is 2 December. Submission closes on 4 December at 22:00 GMT.

## Latest verification

24 November 2026, work item 1:

- Before any edits, `git status` showed branch `main` level with
  `origin/main` at `188869a` and a clean tree. The remote matches
  `https://github.com/WilliamKyaww/Kiro-Nexus`.
- After the edits, only new untracked workflow files were present. No
  tracked file had changed.
- `AGENTS.md` and both steering files loaded as Kiro workspace rules. The
  `#[[file:STATE.md]]` reference in `workflow.md` was unresolved before this
  file existed. **The next session should confirm** that it now shows this
  content.

## Next action

Write `docs/PRD/structure.md`, `docs/PRD/architecture.md` and
`docs/PRD/techstack.md` from the intake. Start with `structure.md` and stop
for Will's review before creating the first spec.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md`, this file, `docs/intake/2026-11-24-product-brief.md` and
> `docs/intake/kiroween-rules-summary.md`. Draft `docs/PRD/structure.md`
> (audience, core journeys, release scope, screen map, acceptance evidence),
> then `architecture.md` (repository layout, data ownership, interfaces,
> failure behaviour, review contract), then `techstack.md` (choices with
> alternatives). Every PRD requirement must trace to an intake `R-*` or
> `D-*` ID. Resolve or carry forward the intake's open questions, and record
> consequential choices in `DECISIONS.md`. Then create the first native Kiro
> feature spec in `.kiro/specs/<slice-name>/`, stopping at each review point
> (requirements, design, tasks). Do not install dependencies or commit.
