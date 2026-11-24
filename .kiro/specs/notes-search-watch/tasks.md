# Implementation plan: B2 search and external changes

This is the only checklist for this slice. Tick a task only after its
acceptance condition has been seen to pass.

All five tasks were verified by Kiro on 2026-11-24 (evidence: `FEATURES.md`). No
human review has happened yet.

- [x] 1. `sections()` in `packages/markdown`
  - **Acceptance:** unit tests cover the preamble, nested heading paths,
    headings inside code fences, and an empty note.
  - _Requirements: 1.1_

- [x] 2. `SearchIndex`, kept current by service events
  - **Acceptance:** integration tests show that:
    - "judge" finds the kickoff note's "Actions" section, ranked above
      body-only matches;
    - a save in Nexus is reflected straight away;
    - a deleted note disappears from the results.
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 3. Watcher and external-change handling in `WorkspaceService`
  - **Acceptance:** integration tests show that:
    - an external write produces `file.changed` with `source: external`
      within 2 s, and the search index updates;
    - Nexus's own save produces no external event;
    - an external `issues.json` edit reloads it and publishes the change.
  - _Requirements: 2.1, 2.5_

- [x] 4. Search API and UI
  - **Acceptance:** a Playwright test types "judge", opens the "Actions"
    result, and lands on that heading.
  - _Requirements: 1.3_

- [x] 5. Editor protection in the UI
  - **Acceptance:** a Playwright test shows that:
    - with no draft, an external edit reloads the preview;
    - with a draft, an external edit shows "changed outside the editor" and
      keeps the draft;
    - "Compare and choose", then "Overwrite with mine", writes the draft to
      the file;
    - an external delete with a draft offers "Recreate with my text", and
      that recreates the file.
  - _Requirements: 2.2–2.4, 2.6_
