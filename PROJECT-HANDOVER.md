# Nexus project handover

- **Date:** Wednesday 25 November 2026
- **From:** Will, with Kiro (the AI agent that built most of the code so far)
- **To:** Hein, who implements the rest, with Will guiding
- **Repository:** <https://github.com/WilliamKyaww/Kiro-Nexus>, branch `main`
- **State described:** commit `404c4bb`, plus the commit that adds this file

Nexus is our Kiroween 2026 entry: a notebook and project board on your own
computer, in one workspace folder. Notes are plain Markdown files. Issues
live on a board and a calendar. An optional AI assistant answers questions
from the notes and issues (**Ask**), and can propose changes (**Edit**)
that you accept or reject one at a time. Everything works with the AI
switched off.

This file is the starting point. It says what exists, how to run it, how
to work with Kiro here, and what is left. Where it summarises, it names
the file that has the detail.

## 1. Where things stand

| Area | Works today | Still missing |
| --- | --- | --- |
| Notes | Markdown notes, section search, edits made outside Nexus, unsaved drafts kept, backlinks, `[[` link completion | Rename, move and delete; a richer editor (CodeMirror) |
| Projects and board | Board with To do, In progress and Done; a backlog list; dragging or Alt+Arrow to change status; due dates | Ordering cards within a column; the final design |
| Calendar | Month view of issues with a due date | Calendar events; the agenda view |
| Reminders | In the browser and as Windows notifications; "Send test reminder"; "While you were away" | Reminders for events (needs events first); AI-worded reminders |
| Reviewing changes | One change at a time, Accept or Reject, undo that keeps newer edits, recovery after a crash | Proposing new notes; "Restore original" in a conflict |
| Ask (AI, read-only) | Answers with citations that open the exact note heading or issue | Never tried with a real AI model, only with a test double |
| Edit (AI proposes changes) | New issues, links, changed note lines and issue fields such as the due date; a reason after a rejection starts a corrected proposal | Same: real AI untested |
| Desktop app and settings | The same app in an Electron window; AI providers added in Settings, with keys encrypted by Windows in the desktop app | A packaged Windows zip |
| Appearance | Light, dark and Match system, three palettes each | Nothing |
| Wireframe (the new design) | A clickable mock-up in `wireframe/` with fictional data | Hein's feedback, then applying it to the real app (section 5) |
| Packaging and submission | MIT licence; public repository | Windows zip, demo video, write-up, judges' AI route |

**AI caveat.** Every Ask and Edit run so far used a local **test double**: a
fixed, rule-based program that pretends to be an AI and is labelled "test
double, not AI" in the app. It proves the interface and the safety rules,
not how a real model behaves.

**Reviews.** An independent reviewer (Astra 6.2 in the Codex extension, run
by Will) has checked every run so far. Its last report found 17 problems;
all 17 are fixed but not re-reviewed yet
(`docs/reviews/2026-11-25-run6-review.md`).

The detailed, evidence-backed list of what works is `FEATURES.md`. The
opening of `README.md` is out of date: it still says the board, calendar,
reminders and agent edits are not built yet.

## 2. Getting started on your computer

### 2.1 Install once

1. **Node.js 24** (24.14 or newer), the LTS version from <https://nodejs.org/>.
   Node 26 also works. Check in PowerShell with `node -v`.
2. **Git**, from <https://git-scm.com/download/win>, or GitHub Desktop. Set
   your name and email once:
   `git config --global user.name "Your Name"` and
   `git config --global user.email "you@example.com"`.
3. **Microsoft Edge**, which Windows already has. The automated browser
   tests use it.
4. **Kiro**, the IDE, signed in.
5. **Push access:** Will adds you as a collaborator on GitHub (repository
   **Settings → Collaborators**). You can clone without it, but not push.

### 2.2 Get the code and run it

```powershell
git clone https://github.com/WilliamKyaww/Kiro-Nexus.git
cd Kiro-Nexus
npm install          # a few minutes the first time; it also downloads Electron
npm run try          # builds, copies the fictional sample to .tmp/try, opens the browser
```

`npm run try` opens straight into the sample workspace. Stop it with
Ctrl+C. `npm run try:reset` starts again from a clean sample.

Other ways to start it:

- **Double-click `Start Nexus.bat`.** It uses your real profile, so the first
  time it shows the **Workspace** page. The grey text in its boxes is only a
  hint: type a real folder path, for example
  `C:\Users\<you>\Documents\Nexus sample` under **Try the sample**, and
  select **Copy and open**. Until a workspace is open, the side bar links
  send you back to that page. (A fix for this is planned, section 6.3.)
- **The desktop app:** `npm run desktop` (stop the browser one first; only
  one copy may write to a workspace at a time).
- **Ask and Edit with the test double:** `npm run double` in one terminal and
  `npm run demo:ask` in another, then follow "Try Ask and Edit" in
  `README.md`.

### 2.3 Look at the wireframe

Double-click `wireframe/index.html`; it opens in the browser with no
install. It is a mock-up: every name, note and date is made up, nothing is
saved, and no AI runs. Try the Dark mode switch, Ctrl+K, **Apply fixed demo
changes** on Home, and each item in the side bar. It is the basis for
step 4 of the plan.

### 2.4 Check that everything works

```powershell
npm run typecheck      # no errors expected
npm test               # unit and integration tests
npm run test:e2e       # browser and desktop tests, about 3 minutes
npm run scan:secrets   # checks that no API key is in the files
```

On Will's machine on 25 November, with the same test configuration, 356
unit and integration tests passed (50 files), and 70 browser and desktop
tests passed with 2 skipped (those two only take screenshots). Nobody has
run these steps on a fresh clone yet, so if your numbers differ, tell Will.

The Electron tests print `UV_HANDLE_CLOSING` when the app closes. That is
known and harmless.

Your clone has `vitest.config.ts`, so `npm test` should run the whole
suite. Will's own copy has that file deleted (a decision he has not made
yet), which is why his notes mention `.tmp/vitest.config.ts`. You can
ignore that.

Your first clean install is also useful evidence: the submission checklist
needs the setup steps checked on a clean machine
(`docs/submission-checklist.md`). Note anything that did not work as
written.

## 3. Working with Kiro in this repository

Kiro reads standing rules from files in the repository, so it behaves the
same on your machine as on Will's.

- **`AGENTS.md`** holds the working rules: British English, fictional data
  only, test first, local commits, no AI names in commit messages.
- **`STATE.md`** says what is authorised now, what is blocked and what comes
  next. Kiro reads it at the start of every session. Today it says nothing
  new is authorised, so **Kiro will wait for you to name the work.** Tell it
  plainly, for example: "I authorise task 4.2 of
  `.kiro/specs/board-calendar/`, the agenda view. Record it in STATE.md and
  start with the spec."
- **`.kiro/specs/<name>/`** holds a spec for each piece of work:
  `requirements.md` (what), `design.md` (how) and `tasks.md` (the
  checklist). For new work Kiro writes these first and stops after each one
  for your approval.
- **`.kiro/steering/`** holds background Kiro loads automatically: the
  product, the tech stack, the architecture and the source boundaries.
- **`.kiro/hooks/`** runs the review tests when certain files are saved.
- **`.kiro/skills/impeccable/`** is the design skill Kiro used for the
  wireframe. Ask Kiro to use it for UI work.

How changes land:

1. Kiro tests, then commits each finished piece **locally**. It pushes only
   when asked, and `AGENTS.md` currently says the request must come from
   Will (section 6.5). You can always push yourself with `git push`.
2. Before you start a session, run `git pull`, so you have Will's latest
   work. Push when a piece is finished and its tests pass.
3. `STATE.md`, `BACKLOG.md` and `FEATURES.md` change in most sessions. If
   you and Will both work on the same day, agree who updates them, or Git
   will report a conflict when you pull.
4. After a major piece, Kiro writes a **relay**: a message in
   `docs/reviews/relays/` for the reviewer. Send it to Will, who runs the
   review and passes the report back to you.

Rules that keep the project safe:

- Never put an API key in a file, a commit or a chat message. Keys go only
  into Nexus's Settings page, which keeps them out of the workspace.
- Use only fictional data in tests and demos (the sample workspace is
  fictional).
- Do not add `.kiro/` to `.gitignore`; the hackathon rules require it to be
  public.
- Never force-push or rewrite history.
- Treat the review engine (`server/src/review/`), the scheduler
  (`server/src/scheduler/`) and Ask's evidence checks (`server/src/ask/`) as
  delicate. They have many tests for good reasons. Change them only through
  a spec, with tests that fail first, and ask Will to look.

## 4. The plan

This is Will's proposal for how to continue (25 November 2026). Hein has
not agreed it yet.

1. **Push to `main`.** Done: `main` is public, and this file is in it.
2. **Hein clones the repository** and gets it running (section 2).
3. **Implement what is left**, starting with the features the wireframe
   shows that have nothing behind them yet (section 6.2).
4. **Hein reviews the wireframe** and writes down what he likes, dislikes and
   wants changed (template in section 7). The real app's UI is then updated
   from that feedback.

Kiro's suggestions on this plan, for Will and Hein to accept or ignore:

- **Do step 4 before or alongside step 3.** Reviewing the wireframe takes an
  hour or two, and the answers decide which of the step-3 features are worth
  building. For example, if Hein does not want the graph view, nobody spends
  days on it.
- **Put submission needs first.** The feature freeze is on 2 December, seven
  days from now. A working AI route for judges, the Windows zip, the video
  and the write-up are required; the graph view and the activity timeline
  are not. Section 6.1 lists the required items.
- **Port the look in stages.** Change the shell first (top bar, side bar,
  panel), then one screen at a time, keeping the automated tests passing
  after each. The tests find things by their names on screen (for example
  the side bar is "Sections" and the review bar is "Changes awaiting
  review"), so the port must keep those names or update the tests on
  purpose.

## 5. The wireframe and the real app

The wireframe in `wireframe/` is Kiro's design proposal, made on Will's
request on 25 November (DEC-026). Will approved its light direction, and in
run 6 the app took its colours, its six palettes and the Dark mode switch
(DEC-028). The app's layout, side bar, icons and components are still the
older, plainer versions. On 25 November Will decided the app should move to
the wireframe's design, with Hein's feedback deciding the details.

`DESIGN.md` describes the wireframe's design system in words: colours,
type, spacing, components and the rules behind them (for example, amber
only ever means "waiting for your decision").

## 6. What is left

Sizes are Kiro's rough guesses for the work with Kiro doing the coding:
**S** is a few hours, **M** about a day, **L** several days.

### 6.1 Needed for submission

| Item | Notes | Where |
| --- | --- | --- |
| Live AI check (Q1) | Run `npm run live:check` with a free Groq key. Q1 closes only on exit 0 | `docs/judge-ai-route.md` |
| How judges get AI (Q5) | Decide between a team relay (A), the judge's own free key (B) or a local model (C). The PRD's deadline is 1 December | `docs/judge-ai-route.md`, PRD-091 |
| Windows zip of the desktop app | Not built (slice E). Electron Forge is the chosen tool | `docs/PRD/techstack.md` |
| Demo video | Public, under three minutes | `docs/submission-checklist.md` |
| Text description and Kiro write-up | The journal (`docs/journal/`) records how specs, steering, hooks, skills and MCP were used | `docs/submission-checklist.md` |
| Setup checked on a clean machine | Your first clone counts (section 2.4) | `docs/submission-checklist.md` |
| Final rules recheck | Against the live rules | `docs/submission-checklist.md` |

### 6.2 Wireframe features with nothing behind them yet

| Feature | What is missing | Size |
| --- | --- | --- |
| **Graph view** | No service endpoint and no layout. Needs every note's links and issue mentions, a layout method and an accessible drawing. The backlog lists it as after the first release | L |
| **Ctrl+K search** | The search index covers note sections only, not issues. The app can filter issues and pages in the browser, with a small search addition in the service | S to M |
| **Recent notes** in the side bar | No endpoint, and the notes list has no modification times | S |
| **Calendar events and the agenda** | Hein's tasks 4.1 and 4.2. The file format for events is already in `docs/data-format.md`, and reminders already read it | M to L |
| **Assignee** on issues | Not in the data model. Needs a schema change, the data-format document, the issue page, board avatars and the sample data | M |
| **Activity** timeline on issues | Not recorded anywhere. Manual edits keep no history | M to L |
| **New** button (note, issue or event) | UI only; the service can already create notes and issues | S |
| **Workspace switcher** in the side bar | UI only; the service already lists recent workspaces | S |
| **Projects list** in the side bar | UI only; the service already lists projects | S |
| **"+" to add an issue in a board column** | UI only | S |
| **"Scheduled" reminders** on Notifications | The service has only a preview (`/reminders/due`), which the tests use and the UI does not | S to M |
| **"Saved · edited 10 minutes ago"** on a note | Needs modification times, as for recent notes | S |
| **Card ordering** within a column | Hein's task 4.3 (`rank`) | M |

### 6.3 Other open work

| Item | Size | Where |
| --- | --- | --- |
| Side bar links shown as unavailable until a workspace is open (Will asked for this on 25 November) | S | `apps/web/src/App.tsx` |
| Note rename, move and delete | M | `BACKLOG.md` (B2) |
| CodeMirror editor instead of the plain text box | M | `BACKLOG.md` (B2) |
| Event reminders, `?event=<id>` and click-through | S, after events | `.kiro/specs/reminders/tasks.md` task 6 |
| New notes and "Restore original" in Edit | M | `.kiro/specs/edit-first-journey/tasks.md` task 5 |
| AI-worded reminders | M | PRD-042, slice D |
| Update the opening of `README.md` | S | `README.md` |
| Register Playwright MCP in Kiro (a human step) | S | `docs/tooling.md` |

### 6.4 Known problems and limits

- With an unsaved note draft, closing the desktop app may hang. Not
  investigated (`docs/reviews/2026-11-25-run6-review.md`, "Other
  observations").
- One unit test, `server/src/notes/notes.test.ts` ("section search"),
  failed once in a full run and then passed five times. It is a timing
  problem in the test.
- A single **Accept** does not check that the note text is unchanged; only
  "Accept both" does.
- Link detection mishandles a few rare Markdown forms (HTML blocks, links
  inside table cells, link reference definitions).
- No screen reader (NVDA or Narrator) has been tried.
- A real Windows notification has not been watched by a person yet:
  `npm run desktop`, then Notifications → **Send test reminder**.

The full list is under "Unverified" in `STATE.md`.

### 6.5 Waiting for Will

- Send the R6 repairs relay to the reviewer
  (`docs/reviews/relays/2026-11-25-run6-repairs.md`).
- Decide about `vitest.config.ts` (`STATE.md`, human action 7).
- Decide whether to add the `unified` and `remark-parse` libraries for link
  detection, whether a single Accept should check content, and whether to
  investigate the desktop close problem.
- Check that the copyright line in `LICENSE` ("William Kyaww and Hein")
  names you both the way you want.
- Decide whether Kiro may push on Hein's request too. `AGENTS.md` ("Git
  conventions") says pushes need an explicit request from Will.
- Request Kiro credits before 1 December, 20:00 GMT, if wanted.

## 7. Wireframe feedback template (step 4)

Copy this into a new file, for example `docs/design/wireframe-feedback.md`,
and fill in what you have an opinion on. Short notes are fine. Look at each
screen in light and dark, and at phone width too (in Edge, press F12, then
Ctrl+Shift+M, and set the width to 390).

```markdown
# Wireframe feedback (Hein, <date>)

## Overall
- First impression:
- Colours and palettes:
- How busy or calm it feels:
- Text sizes and fonts:
- On a phone:

## Screen by screen
For each: Keep / Change / Remove / Missing, and how important (must, should, nice).

- Top bar (search, Ctrl+K, Dark mode, New):
- Side bar (workspace switcher, sections, projects, recent notes, Settings):
- Home (greeting, Ask box, recent conversations, due soon, "Try the review flow"):
- Conversation (answer, citations, follow-up box):
- Notes (file list, note, outline, linked issues, backlinks, Source and Preview):
- Graph:
- Projects board and backlog:
- Issue page:
- Calendar (month and agenda):
- Notifications:
- Settings:
- Review bar (Accept, Reject, the amber "pending" marks):

## Features
- Wireframe features I want built (section 6.2 of the handover):
- Wireframe features we can drop:
- Ideas not in the wireframe:
```

## 8. Where to find things

| Question | File |
| --- | --- |
| What is authorised, blocked or next? | `STATE.md` |
| What has been checked to work? | `FEATURES.md` |
| What is left, by milestone? | `BACKLOG.md` |
| Why was something decided? | `DECISIONS.md` (DEC-001 to DEC-032) |
| What did we agree the product is? | `docs/PRD/structure.md`, `architecture.md`, `techstack.md` |
| What did Will originally ask for? | `docs/intake/2026-11-24-product-brief.md` |
| How do judges try the AI? | `docs/judge-ai-route.md` |
| Are we ready to submit? | `docs/submission-checklist.md` |
| What happened each day? | `docs/journal/` |
| What did the reviewer find? | `docs/reviews/` |
| What does the design system say? | `DESIGN.md` |
| How is data stored on disk? | `docs/data-format.md` |
| Every other document | `docs/README.md` |

Code layout:

| Folder | What it is |
| --- | --- |
| `apps/web/` | The user interface (React), used in the browser and in the desktop app |
| `apps/desktop/` | The Electron desktop wrapper |
| `server/` | The local service: files, review of changes, search, reminders, AI |
| `packages/` | Code shared by the service and the UI (data shapes, Markdown links) |
| `samples/meeting-workspace/` | The fictional sample workspace |
| `wireframe/` | The design mock-up |
| `tests/e2e/` | Automated browser and desktop tests |
| `tools/provider-double/` | The AI test double |

## 9. Key dates

| Date | What |
| --- | --- |
| 1 December | The PRD's deadline for deciding the judges' AI route (Q5) |
| 1 December, 20:00 GMT | Kiro credit requests close |
| 2 December | Feature freeze |
| 4 December, 22:00 UK time | Submission closes |
