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

### B5 change journal with fixed demo operations (verified by Kiro, 2026-11-24; no human review yet)

These changes come from **fixed, labelled demo operations, not AI**. Edit
runs (run 4, below) propose through the same engine.

- **Apply.** "Apply demo changes (fixed, not AI)" on Home writes two real
  changes:
  - It ticks "Hein builds the calendar view" in the kickoff note.
  - It moves `NEX-1`'s due date from 5 December to 3 December.

  The journal `.nexus/reviews/<runId>.json` is written before either file
  is touched, with per-file before and after hashes and stable `opId` and
  `changeId` values. Evidence: `engine.test.ts` and `review-http.test.ts`.
- **Review.**
  - The note opens on the exact list item, which is highlighted, focused
    and marked "Pending review".
  - The review bar moves between the note and the issue.
  - The issue page marks the due-date field and shows "5 Dec 2026 → 3 Dec
    2026" with its own Accept and Reject.

  Evidence: `b5-review.spec.ts`.
- **Mixed decisions across two files.** A user can accept the note change
  and reject the date. The rejection is undone straight away, Nexus asks why,
  and the reason is saved. The files hold exactly the accepted result after a
  restart. Evidence: the E2E test and engine tests, which read the files.
- **Reversals never guess.**
  - An unrelated manual edit to the note survives a rejection.
  - An edited target becomes `conflicted` (`missing`), and a duplicated
    paragraph with identical neighbours becomes `conflicted` (`ambiguous`).
    In both cases nothing is written, and "Keep current version" closes the
    change.
  - Editing another field of the issue does not block rejecting the date.

  Evidence: `engine.test.ts` and the fast-check property tests in
  `spans.test.ts`. A mutation check showed that the ambiguity test fails if
  reversal guesses.
- **Recovery.** Real service processes were killed mid-run and mid-rejection
  (`NEXUS_FAULT`, exit code 86), and recovered on restart:
  - A crash after the journal write, or between the two file writes, is
    rolled forward to `pending`, with the file hashes matching the journal.
  - A crash after the reversal was journaled is completed as `rejected`.
  - A file edited while the service was down becomes `conflicted`, and the
    newer text is kept.

  Evidence: `review-http.test.ts` and `engine.test.ts`.
- **Idempotent.** A repeated demo or a repeated `opId` applies nothing new.
  Repeating accept or reject is a no-op.
- **Pending dates do not schedule reminders.** At 09:30 London time on the
  proposed date, no reminder is due while the change is pending. One is due
  after it is accepted. Evidence: `GET /api/v1/reminders/due` in
  `review-http.test.ts`, plus `engine.test.ts`.
- **Accessibility.**
  - Every decision works from the keyboard.
  - The feedback box takes focus after a rejection.
  - With `prefers-reduced-motion`, the highlight is a static outline with no
    animation.
  - An unsaved note draft is kept when a change lands.

  Evidence: the second test in `b5-review.spec.ts`.

### B2 slice: section search and outside edits (verified by Kiro, 2026-11-24; no human review yet)

- **Section search.**
  - The Notes sidebar searches note sections: a heading with its text, plus
    any text before the first heading.
  - Heading matches rank first. Prefixes and small typos still match.
  - A result opens the note at that heading.
  - The index is held in memory, rebuilt from the Markdown when the
    workspace opens, and updated on every save and outside edit.
  - Evidence: `notes.test.ts` and `b2-notes.spec.ts` "search lands on the
    matching heading".
- **Outside edits.**
  - An edit in another editor is detected within 2 s, and Nexus's own
    writes are not reported as outside edits. With no draft, the open view
    reloads.
  - With a draft, the draft is kept and Nexus says the note "was changed
    outside the editor". The user can load the new version, or compare and
    overwrite with their own text.
  - A note deleted outside while a draft is open keeps the text and offers
    "Recreate with my text".
  - An outside edit to `issues.json` is reloaded. An invalid edit is never
    overwritten: Nexus keeps its last good copy and refuses writes.
  - Evidence: `notes.test.ts` and `b2-notes.spec.ts`.

### Phase 1 repairs (verified by Kiro, 2026-11-24; no human review yet)

Will ran the app and reported these defects on `2310608`, and Codex
independently reproduced them. Kiro reproduced them again in disposable
workspaces, then implemented and tested the fixes
(`docs/reviews/2026-11-24-phase1-defects.md`).

- **Partial review runs are honest** (`63cdc5b`).
  - Each file's real outcome is shown.
  - Files that failed or were not attempted are never written silently,
    even after a restart. A repeated demo reports the failure instead of
    "already applied".
  - **Retry** re-plans only the outstanding files against their current
    contents. It keeps unrelated newer edits and gives a conflict if the
    same field was edited.
  - **Discard** writes nothing and leaves written sibling changes
    reviewable.

  Evidence:
  - `partial.test.ts` (7 tests, which read the journal and the files);
  - the real-process test with a failed write, then Retry, in
    `review-http.test.ts`;
  - the E2E test in `b5-review.spec.ts`.
- **Note drafts survive** (`0b6c98e`).
  - A draft is kept across Projects, an issue link, Back, automatic review
    jumps and a reload of the tab, scoped to its workspace and note.
  - A save clears only the text it submitted. Text typed during a slow
    save stays as "Unsaved changes".
  - Compare shows the actual disk text and the draft together before
    anything is written.

  Evidence: `drafts.test.ts` and `b2-drafts.spec.ts` (4 tests, one of which
  delays the save on purpose).
- **Issue edits never overwrite each other silently** (`138f326`).
  - The editing base is captured when the first field changes.
  - Stale saves are merged field by field. Different fields from two tabs
    both survive, and the same field gives a conflict showing theirs and
    yours.
  - Adding or removing a link keeps an unsaved title and description.

  Evidence: `workspace.test.ts` "merges a stale edit field by field", and
  `b1-issue-edits.spec.ts` (3 tests, which check the form and the JSON).
- **Usability** (`943465b`).
  - At 390 × 844 and 1360 × 900, the selected change and its Accept and
    Reject are visible together.
  - An opened note starts above the review bar. Focus and the static
    outline under reduced motion still work.
  - Home offers "Open the kickoff meeting note", or "Create your first
    note", with AI off.
  - Product screens no longer show internal planning words.
  - The fixed demo stays labelled.

  Evidence: `usability.spec.ts` (5 tests), and Impeccable detect `[]` on
  the changed UI files.

### C read-only Ask (verified by Kiro, 2026-11-24, against the test double only; no human review yet)

Every answer below came from the deterministic test double
(`tools/provider-double/server.mjs`), a rule-based fixture that is not AI.
**No live provider has been tested**, so these entries show that Nexus's
side of the workflow works. They do not show how a real model behaves (Q1
is open). Spec: `.kiro/specs/ask-readonly/`.

- **Provider settings** (`00084bc`).
  - Settings adds, tests, selects and removes an OpenAI-compatible profile.
    The test probes tool calling and structured output separately and
    shows both results.
  - Remote base URLs must use HTTPS. Plain HTTP is accepted only for
    `localhost`, `127.0.0.1` and `[::1]`.
  - A rejected key (401), rate limiting (429, retried twice while honouring
    `Retry-After`), a timeout and a cancellation each give their own
    message.
  - `GET /providers` never returns a key. In the browser, the key is held
    in service memory only. In Electron, the key is encrypted with
    `safeStorage` in `secrets.bin`, survives a relaunch and never reaches
    renderer storage.
  - Evidence: `providers.test.ts` (4 tests, including a disk scan for the
    fake key) and `c1-providers.spec.ts` (browser and Electron).
- **Read-only by construction** (`f065fa2`, DEC-017).
  - Ask can only search notes, read a note section, query issues and give
    its final answer. A `propose_changes` call, even one prompted by an
    instruction planted in a note, is refused and recorded.
  - Citations use handles that the service assigns during the run.
    Invented handles are removed and counted, and a fact left with no
    sources becomes a suggestion.
  - The "Consulted" note is computed by the service, not by the model.
  - A pending change is reported as proposed, and the accepted value is
    given as the fact. A renamed or missing heading is reported as not
    found.
  - Profiles with structured output but no tool calling use
    retrieval-first mode.
  - Workspace files other than `.nexus/conversations/` are byte-for-byte
    unchanged after every Ask run.
  - Evidence: `ask.test.ts` (11 tests).
- **Home and conversations** (`e6b3aa6`).
  - Home shows the workspace, the model and where excerpts are sent. With
    AI off, the composer is disabled, explains why and still offers the
    notes.
  - An answer shows recorded facts, discrepancies, suggestions and the
    fixture label. Citations open the exact heading or issue, and "← Back
    to conversation" returns to the answer.
  - A run can be cancelled. A failed run offers Retry. A rejected key links
    to Settings. Only one run per conversation can be active at a time.
  - Conversations are saved in `.nexus/conversations/` and survive a
    restart. A run interrupted by a crash is marked as interrupted.
  - Evidence: `ask-http.test.ts` (2 tests against the real service) and
    `c3-conversations.spec.ts`.
- **End-to-end proof in two fictional workspaces** (`a5195b5`).
  - On the kickoff sample, "Which action from the kickoff still has no
    issue?" names "Will writes the judge instructions" as untracked, and
    says that NEX-1 tracks "Hein builds the calendar view".
  - After NEX-2 "Write the judge instructions" is created by hand, the
    same question reports the action as tracked by NEX-2.
  - A second workspace, with different people, actions and the key `OPS`,
    gets answers built only from its own data.
  - Evidence: `c4-ask-proof.spec.ts` (2 tests, with workspace hashes before
    and after), plus the matching service-level test in `ask.test.ts`.
    Kiro also inspected screenshots of the running app at 1360 × 900 and
    390 px wide.

### Corrective pass on `e61a3d4` (verified by Kiro, 2026-11-24, against the test double only; no human review yet)

Will reported six defects against the reviewed baseline `e61a3d4`. Kiro
reproduced each one, fixed it and committed it separately
(`docs/reviews/2026-11-24-e61a3d4-corrective.md`). Live AI behaviour is
still untested.

- **The live check reaches the provider and fails honestly** (`9c77f9c`).
  - `npm run live:check` checks every response and bounds start-up,
    requests and the answer wait. It stops its service on every path.
  - Its exit status shows the outcome: 0 live pass, 1 an answer check
    failed, 2 set-up, 3 key rejected, 4 timeout, 5 no usable capability,
    6 the test double answered (never a live pass), 7 other provider error.
  - The report checks that a recorded fact names the judge-instructions
    action as missing and cites the Actions heading, that NEX-1 is cited
    for the calendar work, and that both citation targets exist.
  - Evidence: `live-check-cli.test.ts` runs the real CLI. Against the
    double it gives exit 6 with all 7 checks passing, and each failure
    class gives its own status. The service process has gone afterwards.
- **Keys stay out of diagnostics** (`0652062`).
  - Provider error text is sanitised before Nexus shows, logs or saves it.
    The sanitiser removes the key, any 8-character fragment of it,
    key-shaped strings and control characters.
  - The live check reads the key at a masked prompt.
  - Evidence: `sanitise.test.ts`, with a synthetic sentinel key and a
    double that echoes it. The sentinel and its fragments are absent from
    the HTTP responses, `providers.json`, `service.log`, the conversation
    file, stderr, and the CLI report and output. The prompt was tested with
    a simulated terminal only.
- **Absence claims need full coverage** (`93310e4`).
  - Issue queries page and support word-based lookups.
  - An answer that says no issue tracks something, made before every
    issue record was read, is shown under "Not confirmed" with "Nexus read
    50 of 51 issues…".
  - Search snippets show accepted note text, with pending edits marked as
    proposed.
  - Evidence: `coverage.test.ts`, in both modes, with 51 issues: a match at
    NEX-51, a genuinely missing task, a claim that stays qualified, and a
    pending checklist tick. `c4-ask-proof.spec.ts` shows the qualifier in
    the browser.
- **One question at a time per conversation** (`9aa6eba`).
  - A second simultaneous send gets 409 with "This conversation is
    already answering a question…", until the first answer is saved.
  - Evidence: `ask-http.test.ts`, with two sessions sending at once, a
    burst of six, a delayed final save, and the conversation files checked
    after a restart.
- **Issue fields typed during a save stay** (`07d38ec`).
  - A save acknowledges only the submitted values. Later typing stays as
    "Unsaved changes", and a second save writes it.
  - Evidence: `acknowledge.test.ts` and `b1-issue-edits.spec.ts`, with the
    save delayed by 1.2 s. The earlier field-merge and link tests still
    pass.
- **Follow-ups use the same conversation** (`1c4cd75`).
  - "Which of those is already tracked?" after the kickoff question names
    NEX-1, using the last 3 answered turns as context: plain text, no
    handles, at most 4,000 characters. Evidence and citations are checked
    again each run.
  - After NEX-2 is created by hand, the next follow-up reports it.
  - Evidence: `ask-http.test.ts` (both modes), `context.test.ts` and
    `c4-ask-proof.spec.ts`.

### Run 5: repairs from the run-4 review, and B4 ordinary reminders (verified by Kiro, 2026-11-24; no human review yet)

The Codex extension, designated Astra 6.2, reviewed run 4 for Will. All eleven
findings are repaired (`1a9c27e`). The record is
`docs/reviews/2026-11-24-run4-review.md`, and each new test fails on an export
of `251188e`. B4 (`0c641a1`) works with AI off; its evidence uses a test clock.

- **Edit and review are safer** (DEC-022).
  - An Edit changes only lines in the section the run read, and only while
    that section still has the text that was read.
  - A proposal that overlaps a change still awaiting review, or builds on a
    proposed issue, is refused, and nothing is written.
  - A change is accepted only when what it needs is really in the files.
    **Discard** asks before undoing the changes that need what it drops.
  - A confirmed "Accept both" or "Reject all" completes after a crash.
  - A proposed issue's key is never reused, and an old link to a rejected
    one says so.
  - An Edit stays bound to the workspace it started in.
  - A failed Edit turn offers **Retry Edit**. When it already proposed
    changes, Nexus asks before running it again.
  - Evidence: `repairs.test.ts` (12 tests), `edit-http.test.ts` and
    `r5-repairs.spec.ts`.
- **Ask's evidence and headings** (DEC-024).
  - A tracked entry needs a strong match. An "untracked" entry is not
    confirmed when a record the run read matches it. A free-text fact about
    a tracked action is shown as not confirmed.
  - The live check fails any other recorded statement about the journey's
    actions. It is tested in two fictional vocabularies.
  - Headings are aligned across the whole document. Search, section reads
    and citations agree through pending, accepted and rejected renames,
    including a rename to another heading's name, and a rename with an
    inserted heading.
  - The retrieval-first issue cap is exact.
  - Evidence: `matching.test.ts`, `live-check-cli.test.ts`,
    `rename.test.ts` and `cap.test.ts`.
- **Dates** (DEC-023).
  - A date drafted in one board reports a conflict instead of overwriting
    another tab's newer date.
  - The date editor names its zone and the day the calendar uses. Calendar
    items show the time in the workspace zone.
  - A time in a clock gap is moved forward with a notice.
  - Evidence: `time.test.ts` and `r5-repairs.spec.ts`.
- **Ordinary reminders (B4)** (DEC-025, DEC-009, spec
  `.kiro/specs/reminders/`).
  - **When.** An all-day due date reminds at 09:00 in the workspace zone, and
    a timed due date or event 60 minutes before. Both can be changed in
    Settings, per workspace.
  - **Accepted data only.** Reminders come from accepted dates only: a date
    awaiting review passed 09:00 with no delivery.
  - **Once.** Each reminder is delivered once:
    - repeated ticks, two tabs and restarts did not repeat it;
    - a crash between recording the intent and confirming it left the
      reminder as missed, not shown again.
  - **While you were away.** Reminders that came due while Nexus was closed
    are listed once, under "While you were away", and are not repeated on
    the next start.
  - **Surfaces.** An in-app notification appears in every tab, with a badge
    on the rail. **Open** goes to the exact issue. An old or foreign
    reminder link explains itself.
  - **Test reminder.** **Send test reminder** delivers a labelled reminder
    at once.
  - **Desktop.** The desktop app adds a native notification from the same
    delivery, and its click opens the issue. With notifications denied, the
    in-app route still works and Nexus says why.
  - **Simulated in the desktop tests:** the Windows toast and its click.
    The test records the native call and emits the click; no OS toast was
    observed.
  - **Events.** Event reminders work from `.nexus/calendar.json`, tested
    with a synthetic event. Hein's event editing is not built yet.
  - Evidence: `reminders.test.ts`, `scheduler.test.ts`,
    `scheduler-http.test.ts` and `b4-reminders.spec.ts` (9 of 9 over three
    repeats).

### Run 4: Ask repairs, a first board and calendar, and the first Edit journey (verified by Kiro, 2026-11-24, against the test double only; no human review yet)

Will authorised five milestones. Every Ask and Edit answer below came from
the test double, so none of this shows how a live model behaves (Q1 is
open).

- **Ask matches meeting actions to issues by evidence** (`ab7d19b`,
  DEC-018).
  - A text lookup that finds nothing ("Hein calendar view") returns the
    project's records instead, so a model that searches with the owner's
    name still reaches NEX-1.
  - Tracking claims are structured entries. Nexus records one as a fact
    only when the run read the action's section and a related issue
    record, or, for "no issue", every issue record. A link to the same
    heading does not count as evidence.
  - Before it accepts an answer about issues, Nexus reads the remaining
    records itself (up to 200).
  - The phrase list for absence claims is gone. "The judge instructions do
    not appear on the board", made after reading no issues, is shown under
    "Not confirmed by the evidence".
  - Evidence: `matching.test.ts` (7 tests, using double variants that
    imitate the live failures), and the existing Ask tests and browser
    journeys.
- **The live check proves the two-turn journey** (`1f48735`).
  - **Turn 1:** the judge instructions are untracked, and NEX-1 tracks the
    calendar work, with the right heading and issue cited.
  - **Between the turns:** the check creates "Write the judge
    instructions" through the issue API.
  - **Turn 2:** asked again in the same conversation, NEX-2 must track the
    action.
  - Notes and issues must be byte-for-byte unchanged by both Ask turns.
  - Both evaluator bugs that Codex reported are fixed, with regression
    tests: a sentence denying the NEX-1 match no longer passes, and
    citation order no longer matters.
  - The browser journey `c4-ask-proof.spec.ts` uses the same evaluator.
  - Evidence: `live-check-cli.test.ts` (14 tests). Against the double, the
    real CLI passes its 17 checks and still exits 6, because a fixture is
    never a live pass.
- **A pending heading rename keeps search, reads and citations in step**
  (`cb92534`).
  - While "Approved heading" awaits a rename to "Pending preview", Ask
    finds the accepted heading, labels the proposed one as pending, and
    reads the section by either slug.
  - Citations open the heading that is on disk, before review, after
    acceptance and after rejection.
  - Evidence: `rename.test.ts` (5 tests), and `headings.test.ts` (3 tests)
    for the note page's link resolver. Both were shown to fail on the old
    code.
- **A first board and month calendar** (`58bcc94`, B3 partial, DEC-019).
  - `/projects/NEX` shows To do, In progress and Done, with the backlog
    kept as a second view.
  - On the board, the user can create issues and open them, and change a
    card's status by dragging it, with Alt+Left Arrow or Alt+Right Arrow
    (announced), or with its status control.
  - Due dates can be changed from a card.
  - `/calendar` shows dated issues on a Monday-first month, in the
    workspace time zone. A due-date edit from either view changes the
    same issue, and both views show it after a restart.
  - A date awaiting review shows as "Proposed" beside the accepted date.
  - At 390 px, the columns stack and the month reads as a list.
  - Everything works with AI off and by keyboard.
  - Not built (Hein's handoff): calendar events, the agenda view,
    ordering within a column and the final design.
  - Evidence: `b3-board-calendar.spec.ts` (3 tests, checking
    `issues.json`), `month.test.ts` (3 tests, including a clock change and
    a Tokyo workspace), and screenshots at both widths.
- **The first Ask → Edit → Review journey** (`1bde4e7`, DEC-020, spec
  `.kiro/specs/edit-first-journey/`).
  - After the kickoff answer, the user selects **Edit** and asks Nexus to
    create the missing issue, link it to its heading and update the note
    line. Nexus writes three changes for review:
    - new issue NEX-2 "Write the judge instructions";
    - its link to *Kickoff › Actions*;
    - the note line "Will writes the judge instructions (NEX-2)".
  - The note line opens focused and highlighted. The link and the new
    issue are highlighted on NEX-2's page, and each change opens from the
    answer's **Proposed changes** list.
  - Each change has its own Accept and Reject.
    - Accepting the note line first asks **Accept both**, because it
      needs the new issue.
    - Rejecting the new issue lists the link and the note line, offers
      **Cancel** or **Reject all 3**, and undoes all three.
  - An unrelated manual edit to the same note is kept, and the pending
    changes survive a restart.
  - Ask stays read-only. It is never offered the write tool, and it does
    not count a pending issue as a record until it is accepted.
  - Edit is chosen for one message at a time, and needs a model that has
    shown tool calling.
  - Evidence:
    - `create.test.ts` (6 tests: the journal, the files, a restart and a
      crash);
    - `edit.test.ts` (6 tests, on the coordinator);
    - `c5-edit-journey.spec.ts` (2 browser tests, checking the files and
      the journal);
    - screenshots at 1360 × 900 and 390 × 844.

### Run 6: run-5 repairs, light and dark appearance, the J7 correction loop, and backlinks (verified by Kiro, 2026-11-25; independently reviewed: not ready; R6 findings repaired, not yet re-reviewed)

Astra 6.2 reviewed run 6 and found R6-1 to R6-17
(`docs/reviews/2026-11-25-run6-review.md`). Kiro repaired all seventeen in `3828752` to
`26951fc` (DEC-031), each with a test that failed first. The reviewer confirmed the main
paths before the repairs; nobody has re-reviewed the repairs yet. What now holds, on the
paths Kiro tested:

- **Edit and review:** Reject finds a note change only in its own section, so a shared
  neighbouring line elsewhere cannot make it rewrite another section. A change that cannot
  be found blocks new edits in its own section only. A saved group decision accepts
  nothing when a member's lines or value are gone, also in recovery (R6-1, R6-2). A single
  Accept still does not check the note's content.
- **Edit reads:** a section read returns the exact raw lines an Edit may change, and a
  line too long for one read is marked as not editable (R6-9).
- **Ask:** each clause of a recorded fact is checked against the record it names,
  negation included. A statement Nexus cannot check this way, including some correct
  wordy ones, is shown as "Not confirmed". A citation of one of two same-named sections
  with the same first line opens the right one, or says it cannot tell (R6-6, R6-10).
- **Corrections:** a reason is saved with its request, so a crash before the run starts
  leaves **Retry correction** after a restart. A rejected change is superseded only once
  its correction was written. A failed write shows "The corrected change was not written",
  and Discard offers the correction again. The engine refuses a correction that would
  change lines outside the rejected change's lines. Retry on a failed correction turn in
  the conversation retries the same correction (R6-3 to R6-5, R6-7).
- **Reminders:** a delivery log lost while the clock is set back does not repeat a
  reminder (R6-8).
- **Appearance:** an invalid `appearance.json` falls back to the default in the desktop
  app too. Two sessions choosing palettes at once both keep their choice. The scrollbar
  thumb passes 3:1 in every palette (R6-11, R6-12, R6-17).
- **Backlinks and completion:** a backlink opens its passage in an unsaved draft, or says
  it cannot and offers the saved version. The second of two same-named headings is linked
  by its own slug and opens itself. At 390 px the chosen suggestion stays in view, and the
  list opens above the caret near the bottom. A link in indented code is not a backlink
  (R6-13 to R6-16).
- **Evidence:** 356 of 356 unit and integration tests (50 files); 70 browser and Electron
  tests passing, with 2 screenshot runs skipped. The R6 tests are listed per finding in
  the review record's "Resolutions".
- **Not verified:** screen readers; Electron for the R6-13 to R6-15 changes; link
  detection in HTML blocks, table cells, link reference definitions and entities; any
  live model.

- **Run-5 review repairs** (`e2dd950`, DEC-027). All thirteen findings from Astra 6.2's
  run-5 review are repaired, each with a test that failed first. The record is
  `docs/reviews/2026-11-25-run5-review.md`.
- **Light and dark appearance** (DEC-028, PRD-081). It works with AI off, in the browser
  and in Electron.
  - A **Dark mode** switch sits in the side bar on every screen. It works by keyboard,
    keeps focus, and says On or Off. Above 760 px the side bar stays in view on long
    pages; at 390 px the switch is at the top of each page.
  - **Settings → Appearance** offers Light, Dark and Match system, and three palettes for
    each theme with a small preview each. The current one says "Selected" with a tick. A
    choice applies at once.
  - Match system follows the computer's setting while it is selected, without a reload.
  - The choice is kept in the local profile. It survives navigation, a reload, a
    restart on another port and a workspace switch, and the first paint already uses it,
    in Electron too.
  - Switching keeps a note draft, the conversation and the position in a review.
  - Every palette passes 4.5:1 for text on each surface and 3:1 for control edges and
    focus, computed from the real stylesheet.
  - The wireframe has the same palettes, a switch in its top bar and the same Settings
    section, with its choice in the browser's storage.
  - Evidence: `appearance.spec.ts` (8 tests plus a screenshot run),
    `appearance-conversation.spec.ts` (the provider double, not AI),
    `wireframe-appearance.spec.ts` (3 tests), `appearance.test.ts` (6 tests) and
    screenshots of both themes at desktop and 390 px.
- **The J7 correction loop** (DEC-029, PRD-064). Proved with the test double only, not a
  live model.
  - After a rejection, the review bar asks "What was wrong, or what should be kept?". Skip
    changes nothing more.
  - A reason for an Edit change to an issue field or to note lines starts a correction run in
    the same conversation. The corrected change opens on the same target, highlighted, and
    is accepted or rejected as usual. Rejecting it asks again, without limit.
  - The correction may change only that target. Base values come from the workspace, so
    accepted changes and manual edits stand.
  - Sending the reason twice starts one run. A failed, interrupted or empty correction keeps
    the reason, is listed in the bar after a restart, and offers **Retry correction** and
    **Keep it rejected**.
  - A demo change, a new issue or a new link keeps the reason only.
  - Journey in Edge: Ask, Edit with a date, accept the new task, reject the date, send a
    reason, restart, accept the corrected date. The files then hold exactly the accepted
    changes, and under the test clock the date reminds once and opens NEX-1.
  - Evidence: `correction.test.ts` (5 tests), `correction-http.test.ts` (7) and
    `j7-correction.spec.ts` (2).
- **Backlinks and `[[` completion** (DEC-030, PRD-021). They work with AI off.
  - The note page lists the notes that link to it, each with its section and the line, as
    the preview shows it. Selecting one opens the source note at that passage, focused and
    marked "Linked passage".
  - A link to a heading the note does not have says so. A name that two notes share equally
    is marked ambiguous in the preview and on both panels, and is not followed.
  - The panel follows edits made in Nexus or outside it within seconds, is the same after a
    restart, and shows only the open workspace.
  - In the editor, `[[` suggests notes, and `#` after a name suggests its headings. Arrow
    keys, Enter or Tab, and Escape work, Undo restores the typing, and an alias and the text
    around the link are kept. Shared names show their folders and insert the path.
  - Completion changes only the unsaved draft, which survives navigation until it is saved.
  - Evidence: `links.test.ts` (5 tests), `backlinks.test.ts` (3), `wikilinks.test.ts` (7)
    and `b2-backlinks.spec.ts` (3, in two fictional workspaces).## Engineering foundations

- **Workflow documents and steering** (Kiro, 2026-11-24). `AGENTS.md`,
  `.kiro/steering/workflow.md` and `.kiro/steering/source-boundaries.md`
  were observed loading as workspace rules. The `#[[file:STATE.md]]`
  reference resolves.
- **Toolchain** (Kiro, 2026-11-24): see `docs/toolchain.md`.
  - System Node 24.14.0 and Electron 45.4.1, whose bundled Node is 24.22.3.
  - `npm run typecheck` reports no errors.
  - At `0c641a1` (run 5), the unit and integration suite passes 213 of
    213. Because `vitest.config.ts` is deleted in the working tree, this
    used a temporary copy (`npx vitest run --config .tmp/vitest.config.ts`).
    Plain `npm test` currently finds only 13 tests (see `STATE.md`).
  - `npm run test:e2e` passes 41 tests in Edge and Electron. Two earlier
    flaky observations remain unexplained (see `STATE.md`).
  - `npm run scan:secrets` passes (300 files).
- **Kiro hooks** (Kiro, 2026-11-24). The review and reversal hooks fire on
  agent edits and on file saves, and record PASS or FAIL. See
  `docs/tooling.md`. In run 4 they fired but logged FAIL ("no summary"),
  because their Vitest run finds no tests without `vitest.config.ts`. The
  same tests pass with the temporary config.
- **Dev tooling** (Kiro, 2026-11-24): see `docs/tooling.md`.
  - The Impeccable detector and renders ran.
  - The Playwright MCP stdio smoke test passes 6 of 6 checks.
