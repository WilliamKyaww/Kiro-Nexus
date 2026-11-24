# Features

This file lists only behaviour that someone has verified. Each entry names
the check, who ran it and when. Plans, wireframes, fixtures and replays are
not features.

## Product behaviour

### B1 workspace core (verified by Kiro, 2026-11-24; no human review yet)

- **Notes are plain Markdown.**
  - Create a note (optionally in a folder), edit it and save it, including
    with Ctrl+S.
  - The `.md` file contains exactly the editor's text.
  - The note shows a rendered preview (GitHub-flavoured Markdown, with no
    raw HTML), an outline of its headings and its linked issues.
  - Evidence: `workspace.test.ts` "stores notes byte-for-byte…", and the
    E2E test `b1-browser.spec.ts`, which checks the file contents.
- **Projects and issues are versioned JSON.**
  - Create a project and issues with keys `NEX-1`, `NEX-2` and so on, and
    edit an issue's title, status, priority, due date and description.
  - Each edit increments the issue's revision.
  - Evidence: `workspace.test.ts` and the E2E test.
- **Heading links work in both directions.**
  - From an issue, link a note or a heading in it. Opening the link
    scrolls to that heading, focuses it and labels it "Linked heading".
  - The note's "Linked issues" panel opens the issue.
  - If the heading is renamed, the link reports "heading not found"
    instead of breaking.
  - Evidence: the E2E test and `workspace.test.ts`.
- **Persistence across a restart.**
  - The note, the issue and the link survive stopping and restarting the
    service, and appear in a brand-new browser context.
  - The files on disk match the UI.
  - Evidence: `http.test.ts` "keeps a note and a linked issue across a
    restart…", and the E2E test.
- **Stale-save protection.**
  - A note save with an out-of-date revision writes nothing, keeps the
    editor's text and offers "Load latest" or "Overwrite with mine".
  - Issue updates behave the same way.
  - Evidence: the E2E test, which edits the file on disk while a draft is
    open, and `workspace.test.ts`.
- **Single writer.**
  - A second service refuses the workspace with `423 LOCKED`, names the
    holder's pid and port, and leaves the files unchanged.
  - The desktop app shows this message when the browser service already
    holds the workspace.
  - A lock left by a crashed process is taken over.
  - Evidence: `http.test.ts`, and the E2E test `b1-electron.spec.ts`
    "desktop app refuses a workspace…".
- **The browser session is protected (DEC-011).**
  - A fresh tab without a launch code makes no data request.
  - A launch code works once.
  - Every data route and the event stream returns `401` without a token.
  - A foreign `Host` header gets `403`.
  - No CORS headers are sent.
  - Logs contain no codes, tokens, the control secret, note paths or note
    text.
  - Evidence: `http.test.ts`, the "session model" tests and the E2E test
    "a fresh tab…".
- **Desktop app.**
  - The same UI runs in Electron 45. The renderer runs with `sandbox`,
    `contextIsolation`, no `nodeIntegration` and `webSecurity`.
  - The preload exposes only `appInfo` and `pickWorkspaceFolder`.
  - A note persists across quitting and relaunching.
  - Closing the window releases the lock.
  - Evidence: `b1-electron.spec.ts`, plus a manual run of
    `npm run desktop` closed through the window.
- **Usable with AI off.** Home shows "AI is off". No key is asked for
  anywhere.

## Engineering foundations

- **Workflow documents and steering** (Kiro, 2026-11-24). `AGENTS.md`,
  `.kiro/steering/workflow.md` and `.kiro/steering/source-boundaries.md`
  were observed loading as workspace rules. The `#[[file:STATE.md]]`
  reference resolves.
- **Toolchain** (Kiro, 2026-11-24): see `docs/toolchain.md`.
  - System Node 24.14.0 and Electron 45.4.1, whose bundled Node is 24.22.3.
  - `npm run typecheck` reports no errors.
  - `npm test` passes 38 tests.
  - `npm run test:e2e` passes 4 tests in Edge and Electron.
- **Dev tooling** (Kiro, 2026-11-24): see `docs/tooling.md`.
  - The Impeccable detector and renders ran.
  - The Playwright MCP stdio smoke test passes 6 of 6 checks.
