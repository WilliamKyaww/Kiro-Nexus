# Nexus product intake

- **Status:** Captured from Will's brief, 24 November 2026. This is input to
  the PRD, not an approved PRD.
- **Owners:** Will (product and backend), Hein (presentation and demo).
- **Labels:** `R-*` items are Will's requirements. Change them only with
  Will's agreement. `D-*` items are proposed MVP defaults: some are suggested
  in the brief and some were added by Kiro. The PRD may change a default if it
  records why in `DECISIONS.md`.
- **Rules reference:** `docs/intake/kiroween-rules-summary.md`.

## 1. Problem and pitch

Students and small teams agree on actions in meeting notes, keep a separate
task board, and later find that the two disagree. Nexus helps them answer:
**"What did we agree to, what is already on the board, and what still needs
doing?"** It then lets them fix the discrepancy in the same conversation.

Nexus is a local-first productivity web app with an Electron desktop
wrapper. It joins an Obsidian-style Markdown notebook to a focused Jira-style
project manager. An optional coordinator agent reads both, cites its sources,
and proposes local changes that the user accepts or rejects one at a time.

The Frankenstein claim must be something a judge can check: follow a claim
from prose to a structured issue, edit both through one agent, and keep or
undo each real change on the page where it matters.

## 2. Requirements from Will

### Product principles

- **R-P1** Notes and Projects are fully useful with AI switched off and no
  API key. A user with no key can open the app and start working.
- **R-P2** Data stays local and readable: notes are `.md` files, and
  structured records are documented, versioned JSON with stable IDs.
- **R-P3** Use an original visual identity. Borrow behaviours, not branding.
- **R-P4** Implement only borrowed behaviours that serve this product.

### Home and navigation

- **R-H1** The home page is centred on chat, and is original but inspired by
  Open WebUI, ChatGPT and Codex. Before a conversation it shows a central
  composer, recent conversations, a model selector and the visible workspace
  context. During a conversation it prioritises the answer, its sources and
  any changes awaiting review.
- **R-H2** Notes, Projects, Calendar, Notifications and Settings are directly
  accessible from anywhere.
- **R-H3** Borrowed behaviours: source-linked answers and explicit context
  selection (Open WebUI); scoped toolsets and resumable work (Hermes Agent,
  Clockwork); provider profiles and visible model selection (FreeLLMAPI).

### Notes

- **R-N1** Create, edit, rename, organise (folders) and search plain Markdown
  notes. Preview formatting, follow `[[wikilinks]]` and inspect backlinks.
- **R-N2** Notes live as readable `.md` files in a workspace folder the user
  selects.
- **R-N3** When a note is edited in another editor, Nexus detects the change
  and protects unsaved work.
- **R-N4** A note or a heading can be linked to a project issue, and the user
  can navigate in both directions.

### Projects and calendar

- **R-J1** Projects, a backlog, a Kanban board and issue details. The
  statuses are To do, In progress and Done.
- **R-J2** Create and edit issues. Change status by keyboard or by dragging.
  Set priority and due date. Link supporting notes.
- **R-J3** Project records, issues, calendar entries and reminder settings are
  stored in documented, versioned JSON with stable IDs.
- **R-J4** The board and the calendar refer to the same task record. Editing
  the due date updates both views.
- **R-J5** A simple calendar shows dated tasks and events the user creates.
- **R-J6** Out of the first release (backlog only): sprints, advanced reports,
  multi-user sync and integrations.

### Notifications

- **R-R1** Ordinary time-based reminders for tasks and calendar events.
- **R-R2** An opt-in, agent-personalised reminder may use a linked note or the
  next action. Both kinds of reminder open the relevant item.
- **R-R3** The scheduler owns timing, time zones and duplicate prevention. The
  model only writes optional wording. If AI is off, slow, rate-limited or
  offline, the ordinary reminder is still delivered on time.
- **R-R4** MVP delivery: in-app notifications in the browser, and native
  notifications in Electron where permission allows. Reminders are scheduled
  only while the app runs. Missed reminders are handled once, on reopen. This
  behaviour is documented.
- **R-R5** A clearly labelled test reminder lets someone evaluate
  notifications immediately.

### Coordinator agent and retrieval

- **R-A1** One coordinator with a small set of typed tools. Suggested starting
  tools: search notes, read a note section, query issues, read the calendar,
  and apply a set of reviewable workspace changes.
- **R-A2** Authority comes from the request. A question authorises reading
  only. An explicit edit request authorises tentative local changes inside the
  selected workspace. The agent can never accept its own edits.
- **R-A3** Retrieval: search Markdown by section, and query JSON records
  directly for exact facts such as status and due date. Follow links between
  the two.
- **R-A4** Citations open the actual heading or issue. Answers distinguish
  recorded facts from suggestions. If sources disagree, the answer says so.
- **R-A5** Begin with local full-text search and structured queries. Add
  embeddings only if representative questions show a real retrieval gap. Any
  search index can be rebuilt from the Markdown and JSON.
- **R-A6** Note content is user data, even when it contains text that looks
  like agent instructions.
- **R-A7** The model gets narrowly scoped operations. It has no arbitrary
  filesystem or shell access.

### Change review contract

- **R-C1** **Validate and journal first.** Validate each proposed operation.
  Record its ID, target, base revision and enough before and after data to
  reverse it. Persist the review journal *before* the tentative write.
- **R-C2** **Write and show.** Write the change to the real Markdown or JSON.
  Refresh every affected view without losing the user's place or unsaved
  edits. Open the first affected item, and let the user step between the
  changed pages. Briefly highlight the exact paragraph, card or field, then
  keep a visible pending-review marker after the highlight fades.
- **R-C3** **Decide per change.** Accept and Reject are available for each
  meaningful change. In one run a user can keep a note edit, keep a new task
  and reject a due-date change on another task. Accept finalises a write that
  already exists. Reject reverses only the selected change. The spec must
  define what happens to a dependent link whose proposed target is rejected
  (see D-C1).
- **R-C4** **Feedback and correction.** Rejection takes effect immediately.
  Nexus then asks what was wrong or what should be kept, and the user can
  answer or skip. A correction creates a new reviewable edit for the disputed
  item. Accepted changes are preserved, and correction can repeat for as many
  rounds as needed.
- **R-C5** **Recovery and conflicts.** Pending reviews survive a restart. If a
  manual or external edit overlaps the reversal, Nexus shows the conflict and
  protects the newer work. Retries are safe. Pending dates do not trigger
  reminders until the change is accepted.
- **R-C6** Manual edits and agent edits go through the same workspace
  service. Each file is written atomically. A change spanning several files
  can be recovered.

### Platform, providers and secrets

- **R-S1** One UI runs in a normal browser without Electron and inside the
  desktop wrapper.
- **R-S2** Each workspace has a single writer.
- **R-S3** The Electron renderer is sandboxed with context isolation, and
  only the native operations the UI needs are exposed.
- **R-S4** Windows is the first packaged desktop target.
- **R-S5** In Settings, users can add, test, select and remove multiple
  provider profiles. An OpenAI-compatible endpoint is supported. At least one
  free model route is verified as genuinely usable.
- **R-S6** Nexus checks whether the selected model actually supports
  structured output or tool calling. The model is pinned for each run.
  Provider errors are shown clearly. Steps and retries are limited.
- **R-S7** On desktop, keys are kept in OS-protected secret storage where
  available. Otherwise they are held for the session only. Keys never appear
  in the workspace, renderer persistence, logs, the repository or the
  distributable.
- **R-S8** Credentials for Kiro, Codex and Claude Code development are
  separate from Nexus runtime keys.
- **R-S9** Runtime MCP is optional. If it is added, it exposes a narrow tool
  backed by the same workspace service, and is proved with a real client. This
  is a separate decision from the MCP servers used by the Kiro IDE.

### Kiro development tooling (after the PRD)

- **R-K1** Inventory the skills, powers and MCP servers available in Kiro.
  Configure and smoke-test only the ones that will be used.
- **R-K2** Check the official Impeccable Kiro skill for wireframe critique and
  accessibility. Prefer workspace scope and preserve existing configuration.
- **R-K3** Microsoft Playwright MCP, run against an isolated browser with
  synthetic data. Verify discovery and one harmless call. Once the wireframe
  exists, use it on a real journey.
- **R-K4** Follow the installed Kiro version's supported configuration. Keep
  shareable configuration in `.kiro/` and credentials outside it. Record each
  integration's source, purpose and verification result. Identify any human
  permission click by its exact action. If an optional integration is
  unavailable, use the ordinary local check and continue.
- **R-K5** Add a real Kiro hook once its check exists. Candidate: run the
  focused review and reversal tests when workspace mutation code changes.
  Verify that the hook fires and records a meaningful result.

### Delivery slices (in order)

- **R-D-A Wireframe.** A time-boxed, navigable HTML, CSS and JS wireframe
  using fictional data. It shows Home, Notes, the board, one issue, Calendar
  and the cross-page review interaction. Test keyboard navigation, visible
  focus, highlights under reduced motion, and the state with no key. Fixtures
  count as prototype evidence only.
- **R-D-B Manual baseline.** Get one note and one linked issue persisting
  across a restart early. Then add editing, search, board movement, the
  calendar and ordinary reminders. Smoke-test in both a browser and Electron.
  Exercise the change journal with fixed test operations before an LLM issues
  them.
- **R-D-C Provider settings and read-only AI.** One real answer that cites a
  note and an issue, with both links opening the correct place.
- **R-D-D Agent edits.** Connect agent edits to the tested journal: review
  per item, partial rejection, feedback, correction and restart recovery. Add
  personalised reminder wording from the same grounded context.
- **R-D-E Package and rehearse.** Judges get a free, working route to try the
  product and its AI workflow, with no paid account and no bundled private
  key. A test build is acceptable. Use a synthetic sample workspace and check
  the instructions on a clean setup. Label any fixture or replay used.

### Team and schedule

- **R-T1** Will owns persistence, change review, provider integration and the
  coordinator. Hein can own navigation, board and calendar presentation,
  sample data, accessibility checks and the demo journey.
- **R-T2** Agree the issue shape and the review states early, so Hein can
  build against fixtures while Will implements persistence. Each person has
  one active implementation slice at a time.
- **R-T3** Deadline Friday 4 December 2026, 22:00 UK time (GMT). Feature
  freeze on Wednesday 2 December.
- **R-T4** If time is short, protect the manual baseline, the grounded answer
  and the cross-page review. Cut extra providers, visual graph views and
  orchestration frameworks first.

### Final demonstration

- **R-V1** A fictional project meeting. A note records what Will and Hein
  agreed. The board already holds one of the commitments and is missing
  another. The user asks Nexus what is outstanding and opens its sources. The
  user then asks for updates to the note and the board. They accept the
  checklist edit and the new task, reject one proposed date, explain the
  correction, accept the revised date, and open the final task from its
  reminder.

### Release checks

- **R-V2** Manual note, issue, calendar and ordinary reminder flows with no
  model and no key.
- **R-V3** One answer supported by both data sources, and one question with
  insufficient evidence.
- **R-V4** Mixed accept and reject decisions across two files, a restart
  during review, and a manual edit made before a rejection. Verify the actual
  file contents.
- **R-V5** A provider failure and a duplicate reminder attempt. Check that the
  fallback is usable and that exactly one reminder is delivered.
- **R-V6** A fresh browser run, a packaged Windows run and a keyboard-only
  review.

### Submission evidence

- **R-E1** The root `.kiro/` directory stays in the public repository. Record
  meaningful uses of specs, steering and hooks as they happen, including any
  decision they improved or defect they caught.
- **R-E2** Track licences, attributions and incorporated pre-existing work.
- **R-E3** Prepare a detectable open-source licence, reproducible
  instructions, a working app or test-build URL, a public YouTube demo under
  three minutes, and a clear write-up of how Kiro was used.
- **R-E4** Will and Hein control publication and submission. Agents never
  publish or submit.
- **R-E5** Judges score impact, technological implementation, design,
  innovation and presentation equally, after an initial eligibility check.

### Source boundaries

- **R-B1** Manuscript, Temporal, freellmapi and Clockwork under Verdanta
  Internal Tools are feature inspirations only. See
  `.kiro/steering/source-boundaries.md`.

## 3. Proposed MVP defaults

| ID | Default | Origin |
| --- | --- | --- |
| D-S1 | TypeScript, React and Vite for the web UI. A small local TypeScript service owns workspace access. Electron provides desktop integration. Browser and Electron both talk to the same local service over HTTP on localhost. | Brief |
| D-S2 | The local service is the single writer. It takes a lock file in the workspace, and a second instance opens read-only or refuses. | Kiro |
| D-S3 | A small typed orchestration loop. LangChain or LangGraph only if a specific requirement justifies it. | Brief |
| D-S4 | Start with local full-text search over Markdown sections plus direct JSON queries. No embeddings in the MVP. | Brief |
| D-W1 | Workspace layout: notes as `.md` anywhere under the workspace root, and structured data in `.nexus/` (for example `projects.json`, `issues.json`, `calendar.json`, `reminders.json`, `reviews/`), each file with a `schemaVersion`. | Kiro |
| D-W2 | Every JSON record and every note carries a revision (content hash or counter), used as the base revision for change review and conflict detection. | Kiro |
| D-W3 | Atomic write per file: write a temporary file in the same folder, flush it, then rename it over the original. A multi-file change is recovered from the review journal on start-up. | Kiro |
| D-C1 | Dependent links: if the target of a proposed link (for example a new task) is rejected, the link is rejected with it. The UI states this before it happens, and the dependent change is shown as "rejected because its target was rejected". | Kiro |
| D-C2 | Review states for each change: `pending`, `accepted`, `rejected`, `conflicted`, `superseded` (replaced by a correction). Agree these early with Hein (R-T2). | Kiro |
| D-C3 | Reminders are computed only from accepted data. A pending due date is shown as proposed and never scheduled. | Kiro, from R-C5 |
| D-K1 | Kiro integrations to evaluate: the Impeccable skill (R-K2) and Playwright MCP (R-K3). The first hook targets the review and reversal tests (R-K5). | Brief |
| D-E1 | Judge route: a packaged Windows test build plus a browser run from source, both shipped with the synthetic sample workspace. AI uses a free provider route that the judge configures with their own free key. A clearly labelled replay mode is a fallback only if no free route is reliable. | Kiro |

## 4. Open questions for the PRD

1. Which slice gets the first native spec? Proposal: the manual baseline core
   (one note and one linked issue persisting across a restart through the
   workspace service), because every later slice depends on it. The wireframe
   (R-D-A) is time-boxed and may use a lightweight spec of its own.
2. Which free model route is genuinely usable, and does it support tool
   calling or structured output? This must be verified at implementation time
   (R-S5, R-S6). Do not assume an answer.
3. How should heading-level links (R-N4) be anchored so that they survive a
   heading being renamed? Possible options: a heading slug, or a stable block
   ID comment.
4. How are time zones stored? Proposal: store instants in UTC with the user's
   IANA zone, and treat all-day dates as local dates.
5. Should the browser build send in-app notifications only while the tab is
   open? R-R4 implies yes. Confirm and document this.
6. Is runtime MCP (R-S9) worth building before the deadline? The default is
   no unless time allows after slice D.
