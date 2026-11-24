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

These changes come from **fixed, labelled demo operations, not AI**. Agent
proposals arrive in slice D and will use the same engine.

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

## Engineering foundations

- **Workflow documents and steering** (Kiro, 2026-11-24). `AGENTS.md`,
  `.kiro/steering/workflow.md` and `.kiro/steering/source-boundaries.md`
  were observed loading as workspace rules. The `#[[file:STATE.md]]`
  reference resolves.
- **Toolchain** (Kiro, 2026-11-24): see `docs/toolchain.md`.
  - System Node 24.14.0 and Electron 45.4.1, whose bundled Node is 24.22.3.
  - `npm run typecheck` reports no errors.
  - `npm test` passes 139 tests (corrective pass, at `1c4cd75`).
  - `npm run test:e2e` passes 29 tests in Edge and Electron, and 58 of 58
    with `--repeat-each=2`. Two flaky observations remain unexplained (see
    `STATE.md`).
  - `npm run scan:secrets` passes.
- **Kiro hooks** (Kiro, 2026-11-24). The review and reversal hooks fire on agent edits and on file saves, and record PASS or FAIL. See `docs/tooling.md`.
- **Dev tooling** (Kiro, 2026-11-24): see `docs/tooling.md`.
  - The Impeccable detector and renders ran.
  - The Playwright MCP stdio smoke test passes 6 of 6 checks.
