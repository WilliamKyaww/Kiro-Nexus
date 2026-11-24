# State

- **Date updated:** 2026-11-24
- **Active phase:** Work item 2, PRD and first Kiro spec
- **Status:** PRD drafted and committed locally. **Waiting for Will to
  review** `docs/PRD/` and the proposed decisions DEC-005 to DEC-010.
- **Previous phase:** Work item 1, workflow (`20e93f2`), plus the
  milestone-commit policy (`db3d681`)
- **Active spec:** none yet. The next spec is B1,
  `.kiro/specs/workspace-core/`.

## Authorised scope

- Local edits inside this checkout.
- **Git:** local milestone commits are authorised under DEC-004. After each
  completed and verified major update, commit without asking. Stage only the
  relevant files by name, review the staged diff, add no AI trailers, and
  report the short hash. Pushing, creating branches, opening pull requests
  and publishing need an explicit request.
- **Not authorised:** installing dependencies, scaffolding the product,
  configuring MCP, skills or hooks (work item 4), publication and
  submission.

## Blockers and risks

- **Blocker:** none. The B1 spec waits on Will's review of the PRD.
- **Risk:** the free model routes are unverified (PRD Q1). They will be
  tested in slice C, with a 30 November deadline.
- **Risk:** the dev machine has Node 24.14.0 and the PRD targets Node 26
  LTS. Upgrade, or confirm Node 24 as the fallback, when B1 scaffolds the
  project.
- **Risk:** Kiro cannot fetch the live Devpost pages (HTTP 403). A final
  manual recheck is on `docs/submission-checklist.md`.
- **Dates:** the Kiro credit request deadline is 1 December 2026 at 20:00
  GMT. The feature freeze is 2 December. Submission closes on 4 December at
  22:00 GMT.

## Latest verification

24 November 2026, work item 2:

- I wrote `docs/PRD/structure.md`, `architecture.md` and `techstack.md`.
  Each PRD requirement cites an intake ID, and the intake's open questions
  are either answered (structure.md section 11) or carried forward as Q1 to
  Q4.
- I added foundation steering: `product.md` (auto), and `tech.md` and
  `structure.md` (fileMatch). In this session, Kiro listed `product.md` as
  an auto-included resource (`steering::nexus-product`). Whether the
  `#[[file:...]]` references resolve inside these steering files has not
  been observed yet.
- In this session, `workflow.md` showed the content of `STATE.md`, so its
  reference resolves. This was the check the previous handoff asked for.
- This is document work only. No code exists and no tests have run.

## Next action

Will reviews the PRD. Then create the B1 spec, `.kiro/specs/workspace-core/`,
starting with `requirements.md`, and stop for review.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md`, this file and `docs/PRD/` (structure, architecture,
> techstack). If Will has approved the PRD, set DEC-005 to DEC-010 to
> Accepted, or apply his changes first. Then create the native Kiro feature
> spec `.kiro/specs/workspace-core/` for slice B1 (DEC-010), using the
> requirements-first workflow:
>
> 1. `requirements.md`: EARS acceptance criteria, each citing a `PRD-xxx`.
>    Cover the service with its loopback token, the lock, atomic writes, the
>    `.nexus` schemas, `docs/data-format.md`, one note and one linked issue
>    persisting across a restart, a minimal UI, and a smoke test in both the
>    browser and Electron.
> 2. `design.md`.
> 3. `tasks.md`.
>
> Stop at each review point. Installing dependencies and scaffolding are
> authorised only once the B1 tasks have been approved. Commit each
> completed milestone locally under DEC-004, and do not push.
