# Nexus

Nexus is a local-first Markdown notebook and project board in one
workspace. It runs in a normal browser and in an Electron desktop window,
and both are useful with AI switched off. It is Will and Hein's entry in the
Frankenstein category of Kiroween 2026.

**Status:** this is an early build. Working now:

- notes, projects, issues and heading links, which persist;
- section search;
- detection of outside edits, without losing unsaved text;
- per-change review of edits, demonstrated with fixed operations (not AI).

The board, calendar, reminders and AI arrive in later slices; see
`STATE.md` and `BACKLOG.md`.

## Requirements

- Windows 10 or 11 (the first target; the browser route also runs elsewhere)
- Node.js 24.14 or newer, within the Node 24 line (`.nvmrc`), or Node 26
- Microsoft Edge, which is used only for the end-to-end tests

## Try it

```powershell
npm install
npm run try          # build, copy the fictional sample to .tmp/try, open the browser
```

### A five-minute walkthrough (fictional sample)

1. **Notes.**
   - Open *meetings / 2026-11-24 kickoff*.
   - Create a note of your own with a few `##` headings, edit it and press
     Ctrl+S.
2. **Projects.**
   - Open *NEX*, then *NEX-1*. Under **Linked notes**, choose your note and
     a heading, then select **Add link**.
   - Open the link: the note scrolls to that heading.
   - The note's **Linked issues** panel leads back to the issue.
3. **Restart.** Press Ctrl+C in the terminal, run `npm run try` again, and
   find everything intact.
4. **Review.**
   - On **Home**, select **Apply demo changes (fixed, not AI)**.
   - Accept the ticked checklist item on the note page.
   - Reject the due-date change on `NEX-1`, and give a reason or skip.
   - Inspect `.tmp/try/workspace/` to see the real files.
5. **Outside edits.** Edit the kickoff note in another editor while it is
   open in Nexus, with and without unsaved text in the Nexus editor.
6. **Search.** Type "judge" in the Notes search box.

`npm run try` keeps running and prints the address. While it runs:

| Command | Effect |
| --- | --- |
| `npm run open -- --try` | Open a fresh browser session (for example in another browser) |
| `npm run stop -- --try` | Stop the service cleanly, which releases the workspace lock |
| Ctrl+C in its terminal | The same as `npm run stop -- --try` |

Desktop app on the same try workspace:

```powershell
npm run desktop      # close the browser service first: one writer per workspace
```

If the browser service is still running, the desktop app opens on the
Workspace page with a message that the workspace is in use. This is the
single-writer lock at work.

Start again from a clean sample with `npm run try:reset`.

## Your own workspace

```powershell
npm start                       # real profile in %APPDATA%\Nexus; opens the last workspace
npm start -- --workspace "C:\path\to\folder"
npm run desktop -- --real       # desktop app on the real profile
```

Notes are saved as `.md` files in that folder, and project data in its
`.nexus` subfolder (`docs/data-format.md`).

## How sessions work

The service listens only on `127.0.0.1`. The launcher opens the app with a
single-use launch code in the URL fragment, and the page exchanges it for a
session token held in that tab. A tab opened any other way shows "Open
Nexus from its launcher". In that case, run `npm run open`. See
`docs/PRD/architecture.md` section 4.1.

## Develop and test

```powershell
npm run typecheck
npm test             # unit and integration tests (runs the real service process)
npm run test:e2e     # builds, then Playwright: browser journey in Edge plus Electron smoke test
npm run mcp:smoke    # dev tooling: Playwright MCP smoke test against the wireframe
```

The wireframe is in `wireframe/index.html`. It uses fictional data and runs
no AI.

## Documentation

`AGENTS.md` sets out the working rules, and `docs/README.md` maps every
document to the question it answers. Specs live in `.kiro/specs/`.

## Licence

To be chosen by Will and Hein before submission. The repository needs an
open-source licence that GitHub can detect; see
`docs/submission-checklist.md`. Third-party work is listed in
`docs/licences.md`.
