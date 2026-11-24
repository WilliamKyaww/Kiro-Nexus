# State

- **Date updated:** 2026-11-24 (overnight run in progress)
- **Active phase:** Overnight autonomous run. Milestones A to D are below.
- **Active milestone:** A. PRD amendments, B1 spec, W4 tools and wireframe.
- **Active spec:** `.kiro/specs/workspace-core/` (B1)
- **PRD:** approved by Will at `7b775cd`, with amendments 1 to 4 (DEC-011
  to DEC-014). DEC-005 to DEC-010 were accepted by Will on 2026-11-24.

## Temporary authorisation (overnight run, granted by Will on 2026-11-24)

This section survives context compaction. It applies until Will returns and
replaces it.

- **Authorised without further approval:**
  - Update the PRD and `STATE.md`.
  - Write and self-review native Kiro specs through requirements, design and
    tasks. This replaces the requirement to stop at each spec review point,
    for this scope only.
  - Configure the named workspace dev tools (Impeccable, Microsoft
    Playwright MCP) and the focused Kiro hook.
  - Scaffold the project and install project-local dependencies from their
    official sources (the npm registry).
  - Implement milestones A to D, run the app and tests, and make local
    milestone commits under DEC-004.
- **Milestones in order:**
  - **A.** Apply PRD amendments 1 to 4. Write the B1 spec. Inventory, set
    up and smoke-test the W4 tools. Make a brief navigable wireframe of the
    note, the linked issue and the review interaction.
  - **B.** Implement B1 end to end: note and linked issue, links both ways,
    edit, restart, lock and stale-save protection, browser and Electron
    smoke tests, morning commands.
  - **C.** Implement the B5 journal engine and a small review UI driven by
    fixed, labelled operations. Cover accept and reject, a restart during
    apply and during rejection, a repeated operation, an ambiguous paragraph,
    an unrelated manual edit surviving, and a pending date not triggering a
    reminder. Add the focused Kiro hook and verify that it fires.
  - **D.** Implement a B2 notes slice: heading-level search, and external
    file changes that never discard an unsaved buffer.
- **Not authorised:**
  - Remote Git actions (push, branches on the remote, pull requests),
    publication, deployments, account changes and paid services.
  - System-wide installs or upgrades. Node stays at 24.14.0 unless a human
    decides otherwise.
  - Provider credentials. Tonight uses only fictional data and needs no
    keys.
- **Working agreement:**
  - One active slice at a time.
  - Synthetic data, temporary test workspaces and isolated app profiles.
  - Verdanta Internal Tools stays out of every read, search and index.
  - Distinguish Kiro's self-review from human review.
  - If a check is blocked, record the exact failure, mark it unverified and
    continue.
  - Record assumptions for Will or Hein in the "Assumptions to check"
    section below.
  - Hein owns the final visual design and the board and calendar
    presentation.

## Git

Local milestone commits under DEC-004:

- Stage files by name and review the staged diff.
- Use the configured identity, with no AI trailers.
- Report the short hash.
- Stay on `main`.

## Blockers and risks

- **Blocker:** none.
- **Risk:** the free model route is still unverified. It stays open for
  slice C (DEC-014).
- **Dates:** Kiro credit requests close on 1 December at 20:00 GMT. The
  feature freeze is on 2 December. Submission closes on 4 December at
  22:00 GMT.

## Milestone log (overnight)

| Milestone | Status | Commit | Evidence |
| --- | --- | --- | --- |
| A | Done | see `git log` (`docs: amend PRD, add B1 spec, wireframe and dev tooling`) | The B1 spec was self-reviewed by Kiro. Impeccable detect returned `[]` after one fix, and its renders were checked. The Playwright MCP stdio smoke test passed 6 of 6. Registering the server with Kiro is blocked by the permission policy (see `docs/tooling.md`) |
| B | Done | see `git log` (`feat: B1 workspace core in browser and Electron`) | `npm run typecheck` has no errors. `npm test` passes 38 tests, and `npm run test:e2e` passes 4 (Edge and Electron). A manual `npm run try` / `open` / `stop` and `npm run desktop`, closed through the window, released the lock. `FEATURES.md` holds the details |
| C | In progress | | |
| D | Not started | | |

## Assumptions to check

| # | Assumption (Kiro's) | For |
| --- | --- | --- |
| 1 | A single root package with path aliases replaces npm workspaces (techstack section 1) | Will |
| 2 | B1 uses a `<textarea>` editor, with CodeMirror deferred to B2 | Will, Hein |
| 3 | The web UI takes a typed folder path, because browsers have no native picker | Hein |
| 4 | The wireframe's palette and layout are placeholders, and Hein owns the final identity | Hein |
| 5 | Impeccable telemetry was left on globally and disabled per call, so a human should decide whether to run `npx impeccable telemetry off` | Will |
| 6 | The E2E tests use the system Microsoft Edge (`channel: msedge`) rather than downloading Playwright's Chromium | Hein |
| 7 | TypeScript 7.0.2 (the native compiler) is used only for type checking. esbuild and Vite do the transpiling | Will |
| 8 | The `npm run try` workspace is shared by the browser and desktop routes, so running both at once shows the lock message, which is intended | Will |
| 9 | Editing JSON externally while Nexus runs is detected only at the next write (it is refused and reloaded). Live watching of `.nexus/*.json` is not built | Will |

## Human actions pending

- Register Playwright MCP in Kiro, following the exact steps in
  `docs/tooling.md`. Kiro's policy blocks agent writes to `.kiro/settings/`.

## Next action

Milestone C: write the B5 spec, `.kiro/specs/change-journal/`, then
implement the journal engine with fixed, labelled demo operations.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md` and this file, especially "Temporary authorisation". Then
> read the active spec and `docs/PRD/`. Resume at the first milestone in the
> log that is not done. Follow the working loop in `AGENTS.md`. Commit each
> verified milestone locally under DEC-004 and never push. Keep this file
> current after each milestone.
