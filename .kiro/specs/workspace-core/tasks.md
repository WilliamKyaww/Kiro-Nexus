# Implementation plan: B1 workspace core

This is the only checklist for B1. Each task names an observable acceptance
condition. Tick a task only after that condition has been seen to pass.

All ten tasks were verified by Kiro on 2026-11-24 (evidence: `FEATURES.md`).
No human review has happened yet.

- [x] 1. Scaffold the project and toolchain
  - Root `package.json` with pinned exact versions, `.nvmrc`, `tsconfig.json`
    with the `@nexus/*` aliases, `.gitignore` (which must not list `.kiro`),
    the Vitest and Playwright configs and `scripts/build.mjs`.
  - Record the Node versions for the system and Electron in
    `docs/toolchain.md`, and the dependencies in `docs/licences.md`.
  - **Acceptance:** `npm install` succeeds on Node 24.14.0. `npm run build`
    produces `server/dist/main.js`, `apps/desktop/dist/*.cjs` and
    `apps/web/dist/index.html`. `npx tsc --noEmit` reports no errors.
  - _Requirements: 11.1, 11.2_

- [x] 2. Shared schema and Markdown packages
  - Zod schemas for the data model and the deterministic serialiser.
  - `parseHeadings`, `parseWikilinks` and the preview's wikilink plugin.
  - **Acceptance:** unit tests pass for slugs (including duplicates and
    headings inside code fences), for serialiser round trips that are
    byte-stable, and for schema rejection of an invalid issue.
  - _Requirements: 2.1, 6.2, 7.1_

- [x] 3. Atomic writes, path validation and the lock
  - **Acceptance:** unit tests show that:
    - an interrupted temporary write leaves the original intact;
    - `..`, absolute paths, dot-folders and non-`.md` paths are rejected;
    - a live lock gives `LOCKED`;
    - a lock held by a dead pid is taken over.
  - _Requirements: 3.1–3.4, 4.1, 4.4_

- [x] 4. WorkspaceService (notes, projects, issues, links)
  - **Acceptance:** integration tests against a temp folder show that:
    - a created note's bytes equal its input;
    - issue keys increment;
    - a stale `baseRevision` gives `REVISION_MISMATCH` and writes nothing;
    - `linkedIssues` and issue link resolution work both ways, including
      the fallback to a unique heading text.
  - _Requirements: 2.1–2.4, 4.2, 5.1–5.2, 6.1–6.3, 7.1, 7.3–7.4_

- [x] 5. HTTP service with the session model (DEC-011)
  - **Acceptance:** integration tests against a real listening service show
    that:
    - a fresh launch-code exchange works;
    - a reused or expired code gives `401`;
    - every data route and `/events` without a token gives `401`;
    - a wrong `Host` gives `403`;
    - no CORS header is sent;
    - the captured log contains no code, token or secret;
    - the static shell loads without a token.
  - _Requirements: 1.1–1.6, 1.8_

- [x] 6. Persistence across restart and second-instance tests
  - **Acceptance:** an integration test does the following, reading the
    files directly at each check:
    1. Creates a note and a linked issue through the API, then stops the
       service.
    2. Starts a new service with the same profile. It reopens the recent
       workspace, and the API and the files agree.
    3. Starts a second service on the same workspace. It gets `423`, and
       the files are unchanged.
  - _Requirements: 2.3, 3.2, 8.1–8.2_

- [x] 7. Web UI: shell, session bootstrap, Notes, Projects, Issue
  - **Acceptance:** `npm run try` opens a browser in which a user can:
    - create a note with headings and see its preview and outline;
    - create project `NEX` and issue `NEX-1`;
    - link `NEX-1` to a heading;
    - open the note at that heading from the issue, and open the issue from
      the note's "Linked issues" panel.

    A stale save shows the conflict banner and keeps the buffer. A tab with
    no token shows the launcher message.
  - _Requirements: 1.2, 1.7, 4.3, 5.3, 6.4, 7.2–7.3, 9.1–9.4_

- [x] 8. Electron wrapper
  - **Acceptance:** `npm run desktop` opens a window showing the same UI.
    The renderer has `sandbox`, `contextIsolation` and no `nodeIntegration`
    (checked in the test through `webContents.getLastWebPreferences()`).
    Closing the window removes `.nexus/lock`.
  - _Requirements: 10.1–10.5_

- [x] 9. End-to-end smoke tests in the browser and Electron
  - **Acceptance:** `npm run test:e2e` passes:
    - **Browser:** the full B1 journey, including a service restart and a
      relaunch, ending with both items intact in the UI and in the files.
    - **Electron:** launch, create a note, quit, relaunch, and the note is
      still present.
  - _Requirements: 8.1, 10.1, 10.4_

- [x] 10. Documentation and commands
  - `README.md` (morning commands), `docs/data-format.md`, and an update to
    `FEATURES.md` with evidence.
  - **Acceptance:** every command in the README has been run during this
    task and behaved as described.
  - _Requirements: 2.5, 11.1_

- [x] 11. Issue edits never overwrite each other silently (Phase 1 repair 3; added 2026-11-24)
  - **Defect, reproduced on `2310608`:** after a live refresh, tab A's
    title save silently replaced tab B's title. Adding a link cleared an
    unsaved title.
  - **Fix:**
    - The form captures its editing base when the first field changes.
    - `PATCH /issues/:key` accepts `baseValues` and merges field by field:
      fields nobody else changed are applied on top of newer edits, and a
      field someone else changed is a conflict listing theirs and yours.
    - Link add and remove use a separate request that leaves unsaved fields
      alone.
  - **Acceptance:**
    - `workspace.test.ts` "merges a stale edit field by field";
    - `tests/e2e/b1-issue-edits.spec.ts` (3 tests: the same field in two
      tabs, different fields in two tabs, and link add and remove with
      unsaved fields). All three check the form and `issues.json`.
