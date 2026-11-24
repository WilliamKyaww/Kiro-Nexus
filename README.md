# Nexus

Nexus is a local-first Markdown notebook and project board in one
workspace. It runs in a normal browser and in an Electron desktop window,
and both are useful with AI switched off. It is Will and Hein's entry in the
Frankenstein category of Kiroween 2026.

**Status:** this is an early build. Working now:

- notes, projects, issues and heading links, which persist;
- section search;
- detection of outside edits, without losing unsaved text;
- per-change review of edits, demonstrated with fixed operations (not AI);
- read-only Ask: questions answered from your notes and issues, with
  citations, through any OpenAI-compatible provider. So far it has been
  tested only against a local test double, which is a fixture and not AI.
  No live provider has been checked yet.

The board, calendar, reminders and agent edits arrive in later slices; see
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
   - Open *NEX*: a board with To do, In progress and Done. Drag *NEX-1* to
     another column, or focus its card and press Alt+Right Arrow.
     **Backlog** shows the same issues as a list.
   - Open *NEX-1*. Under **Linked notes**, choose your note and a heading,
     then select **Add link**.
   - Open the link: the note scrolls to that heading.
   - The note's **Linked issues** panel leads back to the issue.
3. **Calendar.** Open **Calendar**, then go to December 2026. *NEX-1* is on
   5 December. Change its date there, and the board's card shows the same
   date.
4. **Restart.** Press Ctrl+C in the terminal, run `npm run try` again, and
   find everything intact.
5. **Review.**
   - On **Home**, select **Apply demo changes (fixed, not AI)**.
   - Accept the ticked checklist item on the note page.
   - Reject the due-date change on `NEX-1`, and give a reason or skip.
   - Inspect `.tmp/try/workspace/` to see the real files.
6. **Outside edits.** Edit the kickoff note in another editor while it is
   open in Nexus, with and without unsaved text in the Nexus editor.
7. **Search.** Type "judge" in the Notes search box.

`npm run try` keeps running and prints the address. While it runs:

| Command | Effect |
| --- | --- |
| `npm run open -- --try` | Open a fresh browser session (for example in another browser) |
| `npm run stop -- --try` | Stop the service cleanly, which releases the workspace lock |
| Ctrl+C in its terminal | The same as `npm run stop -- --try` |

### Reminders

Nexus reminds you of dated issues while it is running, with AI off:

- **When.** An all-day due date reminds at 09:00. A timed due date reminds
  60 minutes before. Change both in **Settings → Reminders**.
- **Test it.** On **Notifications**, select **Send test reminder**. A
  labelled reminder appears at once; select **Open** to reach the issue.
- **Accepted dates only.** A date still awaiting review never reminds.
- **While you were away.** Reminders that came due while Nexus was closed
  are listed once, under "While you were away", the next time it opens.
- **In the desktop app**, the same reminder also appears as a Windows
  notification, and clicking it opens the item.

Desktop app on the same try workspace:

```powershell
npm run desktop      # close the browser service first: one writer per workspace
```

If the browser service is still running, the desktop app opens on the
Workspace page with a message that the workspace is in use. This is the
single-writer lock at work.

Start again from a clean sample with `npm run try:reset`.

## Try Ask and Edit

Ask answers questions from the open workspace and never changes your notes
or issues. It saves only the conversation, in `.nexus/conversations/`.
Edit, chosen for one message at a time, proposes changes. Nexus writes them
to the files for you to review, and keeps only what you accept.

### With the local test double (no account, no key)

The test double is a fixed, rule-based fixture, not AI. Every answer it
gives is labelled as such. Use it to see the interface.

```powershell
npm run double       # terminal 1: the test double on 127.0.0.1:47200
npm run demo:ask     # terminal 2: build, then open a separate copy of the sample (.tmp/ask-demo)
```

1. In **Settings → Add an OpenAI-compatible provider**, enter:
   - Name: `Local test double`
   - Base URL: `http://127.0.0.1:47200/v1`
   - Model: `nexus-test-double`
   - API key: any text

   Then select **Add provider**. Nexus tests it and reports "Tool calling:
   Yes".
2. On **Home**, paste "Which action from the kickoff still has no issue?"
   and select **Send**. The answer says that "Will writes the judge
   instructions" has no matching issue, and that NEX-1 tracks "Hein builds
   the calendar view".
3. Open the citations *Kickoff, 24 November 2026 › Actions* and *NEX-1
   Build calendar view*. Each one opens its target. **← Back to
   conversation** returns you to the answer.
4. In the same conversation, ask the follow-up "Which of those is already
   tracked?" The answer names only NEX-1. Ask uses the last few questions
   in the conversation as context, and checks the workspace again for
   each answer.
5. **Edit.** In the same conversation, select **Edit** above the composer
   and send "Create the missing issue, link it to its source heading and
   update the note line." Nexus proposes three changes, and opens the
   first one highlighted:
   - new issue NEX-2 "Write the judge instructions";
   - its link to *Kickoff › Actions*;
   - the note line "Will writes the judge instructions (NEX-2)".

   Then review them:
   - Select **Accept** on the note line. It needs the new issue, so Nexus
     offers **Accept both**.
   - The review bar moves to the link on NEX-2's page. Accept it.
   - To see dependencies the other way, reject the new issue instead.
     Nexus lists the link and the note line, then undoes all three.

   The answer's **Proposed changes** list shows each change's outcome.
   The composer is back in Ask, so asking the kickoff question again
   reports the action as tracked by NEX-2.

Without Edit, you can create the issue yourself in **Projects → NEX** and
ask again, with the same result.

If Ask could not read every issue record, an answer that says something
has no issue appears under **Not confirmed**, with how many records it
read. A conversation answers one question at a time. If you send a
question from another window while an answer is running, Nexus refuses it
with a message and keeps your typed question.

Edit needs a model that has shown tool calling in **Settings → Test**. A
model with structured output only answers in Ask.

`npm run demo:ask` uses its own profile and workspace, so it does not
affect `npm run try`. Stop it with Ctrl+C. To start again from a fresh
sample, delete `.tmp/ask-demo`. A workspace already used for an earlier
run may hold your own changes, so the steps above assume a fresh copy.

### With a real provider

Choose the Groq template in Settings, or enter any OpenAI-compatible
endpoint. Base URLs must use HTTPS; plain HTTP is allowed only for
`localhost` and `127.0.0.1`. In the browser, the key is held in service
memory for the session only. The desktop app encrypts the key with Windows
protection (`safeStorage`), outside the workspace. Free plans may use what
you send for training, so use the fictional sample until you are happy
with that. `docs/judge-ai-route.md` describes a scripted live check and
the routes proposed for judges. Run `npm run build`, then
`npm run live:check`, and paste the key when asked. The prompt masks the
key, so it never appears on screen, in shell history or in an
environment variable. Never type a key into a command line.

Nexus removes keys, fragments of keys and key-shaped strings from provider
error messages before it shows, logs or saves them.

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
npm run test:e2e     # builds, then Playwright: browser journeys in Edge plus Electron tests
npm run scan:secrets # looks for the test keys and real key shapes in files, builds and test output
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
