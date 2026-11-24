# Nexus PRD: product structure

- **Status:** Approved by Will at `7b775cd` on 24 November 2026, with
  amendments 1 to 4 (DEC-011 to DEC-014) applied the same day
- **Owners:** Will (product, persistence, review, providers, agent), Hein
  (navigation, board and calendar presentation, sample data, accessibility,
  demo)
- **Last updated:** 2026-11-24
- **Inputs:** `docs/intake/2026-11-24-product-brief.md` (cited as `R-*`
  and `D-*`) and `docs/intake/kiroween-rules-summary.md`
- **Companions:** `architecture.md` (how it works) and `techstack.md` (what
  it is built with)

## 1. Problem

Students and small teams record agreements in meeting notes and track work
on a separate board. The two drift apart. Later, nobody can easily answer
**"What did we agree to, what is already on the board, and what still needs
doing?"**, and fixing the gap means editing two tools by hand.

Nexus puts a Markdown notebook and a focused project board over one local
workspace. Both work completely without AI. An optional coordinator agent
reads both sources, answers with citations that open the exact heading or
issue, and proposes edits to both. The user keeps or undoes each edit on the
page where it applies.

**Frankenstein pitch.** Nexus joins an Obsidian-style folder of prose to a
Jira-style store of structured records, adds a web app that is also a
desktop app, and puts an agent over both. Its edits are real file writes,
and the user can undo each one individually. A judge can follow one claim
from a sentence in a note to a field on an issue, ask the agent to change
both, and accept or reject each change in place.

## 2. Audience

| Role | Need | Evidence status |
| --- | --- | --- |
| Student project team (2 to 5 people) | Turn meeting notes into tracked tasks without keeping two tools in step by hand | Hypothesis, based on Will and Hein's own experience |
| Small-team lead or solo maker | Plain files they own, a board that is light rather than enterprise-scale, and reminders that actually fire | Hypothesis |
| Hackathon judge | Try the product within minutes, for free, with no paid account, and verify the AI claims personally | Given by the rules (`kiroween-rules-summary.md`) |

**Non-users for the MVP:** large organisations that need permissions,
sprints, reports or multi-user sync (R-J6).

## 3. Product principles

1. **Useful with AI off.** Every manual journey works with no provider and no
   key (R-P1).
2. **Files the user owns.** Notes are ordinary `.md` files, and structured
   data is documented, versioned JSON with stable IDs (R-P2, R-J3).
3. **The agent proposes and the user decides.** The agent only creates
   tentative changes, and nothing is final until the user accepts it
   (R-A2, R-C3).
4. **Grounded or silent.** An answer cites real sources. Where evidence is
   missing or the sources conflict, the answer says so (R-A4).
5. **Original identity.** Nexus borrows behaviours from other products, but
   none of their branding (R-P3, R-P4).

## 4. Core journeys

Each journey lists its trigger, its steps and the outcome it must reach.
The intake IDs in brackets are the source.

- **J1. First run with no key** (R-P1, R-H2). The user launches Nexus and
  chooses either a workspace folder or the sample workspace. Home shows the
  composer with "AI is off: set up a provider", and Notes, Projects,
  Calendar, Notifications and Settings are all reachable. *Outcome:* the user
  creates a note and an issue without ever seeing a key prompt.
- **J2. Capture a meeting** (R-N1, R-N4). The user writes a meeting note
  containing a heading such as "Actions". From an issue, they link that note
  heading, and the note then shows the linked issue. *Outcome:* the user can
  navigate in both directions, and the link survives a restart.
- **J3. Run the board** (R-J1, R-J2). The user creates issues and moves them
  between To do, In progress and Done, either by dragging or with the
  keyboard. They also set priority and due date. *Outcome:* the change is
  persisted to `issues.json` and visible after a restart.
- **J4. Dates and reminders** (R-J4, R-J5, R-R1 to R-R5). The user sets a due
  date on an issue and adds an event to the calendar. *Outcome:* the board
  and the calendar show the same date, a reminder fires once at the right
  local time, and clicking it opens the item. A "Send test reminder" button
  shows a reminder immediately.
- **J5. Edit outside Nexus** (R-N3). The user edits a note in VS Code while it
  is open in Nexus. *Outcome:* Nexus picks up the change. If the user has
  unsaved edits, Nexus keeps them and shows the conflict instead of silently
  overwriting either version.
- **J6. Ask what is outstanding** (R-H1, R-A1 to R-A5). In Ask mode, the
  user asks "What did we agree, what's on the board, what's missing?"
  *Outcome:* an answer split into recorded facts, discrepancies and
  suggestions. Each citation opens the exact heading or issue. If the
  evidence is insufficient, the answer says so.
- **J7. Fix it from the conversation** (R-C1 to R-C4). In Edit mode, the user
  asks Nexus to update the note checklist and add the missing task. Nexus
  writes tentative changes, opens the first affected item and highlights the
  change, and a review bar lets the user step through each change. The user
  accepts the checklist edit and the new task, and rejects one due date.
  Nexus asks why, the user explains, and Nexus proposes a corrected date,
  which the user accepts. *Outcome:* the files contain exactly the accepted
  changes.
- **J8. Recovery** (R-C5). The app closes during review. On reopen, the
  pending changes are listed and still markable. A manual edit made to a
  changed paragraph before rejection is kept, and the conflict is shown.
  *Outcome:* the user's newer work is never lost.
- **J9. Configure AI** (R-S5 to R-S7). In Settings, the user adds an
  OpenAI-compatible provider profile and tests it. Nexus reports which
  capabilities it found (tool calling, structured output). The user selects
  the profile and model on Home. *Outcome:* the run uses the pinned model,
  provider errors are clear, and no key is ever written to the workspace or
  the renderer.
- **J10. Personalised reminder** (R-R2, R-R3). The user opts in to agent
  wording. *Outcome:* the reminder fires at the scheduled time either way. It
  uses AI wording that draws on the linked note or next action when that
  wording is ready in time, and the ordinary text otherwise.

The final demonstration (R-V1) is J6, then J7, then a J10-style reminder,
run on the synthetic meeting workspace (see section 8).

## 5. Release scope

### In the first release (MVP)

- Workspace: choose a folder or open the sample. One writer per workspace.
- Notes: folders, create, rename, move, delete, edit, preview, search,
  `[[wikilinks]]` (including `[[Note#Heading]]` and `[[Note|alias]]`),
  backlinks, detection of external changes, and inline issue-key mentions
  (`NEX-3`) rendered as links.
- Projects: create and rename projects; a backlog list; a board with three
  fixed columns; issue detail (title, description, status, priority, due
  date, links to notes and headings).
- Calendar: month and agenda views showing dated issues and user-created
  events; create, edit and delete events.
- Notifications: ordinary reminders for issues and events, in-app in the
  browser and native in Electron, a missed-reminder summary on reopen, a test
  reminder, and optional personalised wording.
- AI: provider profiles (add, test, select, remove); the coordinator with Ask
  and Edit modes; cited answers; cross-page review with per-change Accept and
  Reject, feedback, correction and recovery.
- Desktop: a packaged Windows build (zip). The browser runs from source.
- A synthetic sample workspace and judge instructions.

### Out of the first release

- Sprints, advanced reports, multi-user sync and integrations (R-J6).
- Custom board columns, sub-tasks, attachments and comments.
- Embeddings or vector search (R-A5, unless evidence shows a retrieval gap).
- Graph views and extra provider types (R-T4).
- Reminders while the app is closed (R-R4).
- macOS and Linux packages (R-S4).
- Runtime MCP server (R-S9; P1 if time allows).
- LangChain or LangGraph (D-S3).

### Cut order if time tightens (R-T4)

Cut first: extra providers, then graph views, then orchestration frameworks,
then personalised reminder wording, then inline issue-key mentions, then the
calendar agenda view.

Always protect: the manual baseline (J1 to J5), the grounded answer (J6),
and cross-page review (J7, J8).

## 6. Screen map

```
App shell (always visible)
├── Left rail: Home · Notes · Projects · Calendar · Notifications (badge) · Settings
├── Workspace name and switcher
└── Review bar (only while changes are pending; persists across pages)

Home  /
├── Empty state: central composer, Ask/Edit switch, model selector or
│   "AI off" chip, context chips (workspace, selected notes or project),
│   recent conversations
└── Conversation  /c/:id
    ├── Transcript; answer card: Facts · Discrepancies · Suggestions
    ├── Source chips → open note heading or issue
    └── "Changes for review" panel grouped by file

Notes  /notes/*path
├── Folder tree and search
├── Editor (Markdown) ↔ preview toggle or split
└── Side panel: backlinks · linked issues · outline (headings)

Projects  /projects/:key
├── Board (default): To do · In progress · Done
├── Backlog: sortable list
└── Issue  /projects/:key/issues/:issueKey  (drawer on the board, page on direct link)
    └── Fields · description · linked notes and headings · pending-change markers

Calendar  /calendar
├── Month view (default) · Agenda view
└── Event dialog (create or edit); dated issues open the issue

Notifications  /notifications
├── Delivered and missed reminders
└── "Send test reminder" (labelled as a test)

Settings  /settings
├── Workspace (folder, time zone)
├── AI providers (profiles, test results, capabilities, remove)
├── Reminders (default timing, personalised wording opt-in)
└── About and licences

First run  /welcome
└── Choose a folder · Open the sample workspace
```

**The review bar** reads: "Change *n* of *m* · *target* · Accept · Reject ·
Previous · Next · All changes". It appears on any page with pending changes.
Moving to a change navigates to its page and scrolls to the target. The
target is highlighted for about two seconds, or with a static outline when
reduced motion is preferred, and then keeps a "Pending review" marker.

## 7. Requirements

Priorities: **Must** is required for submission. **Should** is cut only if
the schedule forces it.

| ID | Requirement | Pri | Source | Acceptance evidence |
| --- | --- | --- | --- | --- |
| PRD-001 | Every manual journey (J1 to J5) works with no provider configured and no key prompt | Must | R-P1 | E2E run with no provider; release check R-V2 |
| PRD-002 | Notes are plain `.md` files under the chosen workspace root. Nexus never adds metadata to them except for edits the user or an accepted agent change makes | Must | R-N2, R-P2 | Byte comparison of files after a manual round trip |
| PRD-003 | Structured data is stored in documented JSON files with a `schemaVersion` and stable IDs | Must | R-J3 | Schema tests; `docs/data-format.md` |
| PRD-010 | The home page is chat-centred, with the composer, recent conversations, model selector and workspace context. Answers, sources and the changes list are prioritised during a conversation | Must | R-H1 | Wireframe review; E2E |
| PRD-011 | The five sections are reachable in one action from every page | Must | R-H2 | Keyboard-only walkthrough |
| PRD-012 | Explicit context selection: the user can add notes or a project as context chips | Should | R-H3 | E2E |
| PRD-020 | Create, edit, rename, move, delete and organise notes in folders | Must | R-N1 | Integration and E2E tests |
| PRD-021 | Preview Markdown (GFM). Follow `[[wikilinks]]` including heading and alias forms. List backlinks | Must | R-N1 | Unit (parser) and E2E tests |
| PRD-022 | Search notes by text, with results at section level | Must | R-N1, R-A3 | Integration test on a fixture workspace |
| PRD-023 | External edits are detected within 2 s. Unsaved buffer edits are never discarded silently | Must | R-N3 | Integration test that edits the file outside Nexus |
| PRD-024 | Link a note or a heading to an issue, and navigate in both directions | Must | R-N4 | E2E |
| PRD-030 | Projects, backlog, board with To do, In progress and Done, and issue detail | Must | R-J1 | E2E |
| PRD-031 | Create and edit issues. Change status by drag and by keyboard. Set priority and due date. Link notes | Must | R-J2 | E2E, including a keyboard-only move |
| PRD-032 | The board and the calendar read the same issue record. A due-date edit in either view updates both | Must | R-J4 | E2E |
| PRD-033 | The calendar shows dated issues and user events, with create, edit and delete | Must | R-J5 | E2E |
| PRD-040 | Ordinary reminders for issues and events open the item when clicked | Must | R-R1, R-R2 | Integration test with a fake clock; E2E |
| PRD-041 | The scheduler owns timing, time zones and duplicate prevention. Each reminder is delivered at most once | Must | R-R3 | Property and integration tests; release check R-V5 |
| PRD-042 | Personalised wording is opt-in and never delays or blocks delivery | Should | R-R2, R-R3 | Test with a slow or failed provider |
| PRD-043 | Reminders are in-app in the browser and native in Electron when permission is granted. They are scheduled only while the app runs. Missed reminders are summarised once on reopen, and this behaviour is documented | Must | R-R4 | E2E; manual Electron check |
| PRD-044 | A labelled test reminder is delivered immediately | Must | R-R5 | E2E |
| PRD-050 | One coordinator with the typed tools search notes, read section, query issues, read calendar and propose changes | Must | R-A1 | Unit tests on the tool schemas |
| PRD-051 | Ask mode is read-only. Edit mode may create tentative changes. The agent cannot accept its own changes | Must | R-A2 | Tests showing that tools are absent in Ask mode and that no accept path exists from the agent |
| PRD-052 | Answers separate facts, discrepancies and suggestions. Citations open the exact source. Citations that do not match a retrieved source are rejected | Must | R-A3, R-A4 | Tests on the citation validator; release check R-V3 |
| PRD-053 | Insufficient evidence is stated, not guessed | Must | R-A4 | Release check R-V3 |
| PRD-054 | Retrieval combines full-text section search with exact JSON queries and follows links. The index can be rebuilt from the files | Must | R-A3, R-A5 | Test that deletes the cache and rebuilds it |
| PRD-055 | Note content is treated as data. An injected instruction cannot widen the agent's authority | Must | R-A6, R-A7 | Adversarial fixture test |
| PRD-060 | Each proposed operation is validated and written to the journal, with ID, target, base revision and before and after values, before the file write | Must | R-C1 | Crash-injection test |
| PRD-061 | Changes are written to the real files. Affected views refresh without losing the user's place or unsaved edits. The first change opens, the target is highlighted, and the marker persists | Must | R-C2 | E2E; check under reduced motion |
| PRD-062 | Each change has its own Accept and Reject. Accept is final with no new write. Reject reverses only the selected change | Must | R-C3 | Mixed-decision test across two files; release check R-V4 |
| PRD-063 | Rejecting a change also rejects the changes that depend on it, after confirmation | Must | R-C3, D-C1 | Unit test |
| PRD-064 | Rejection takes effect immediately and is followed by an optional reason. A correction produces a new reviewable change. Rounds can repeat | Must | R-C4 | E2E of the correction loop |
| PRD-065 | Pending reviews survive a restart. Reversals that overlap newer edits are shown as conflicts, and the newer work is kept. Retries are idempotent | Must | R-C5 | Restart test; release check R-V4 |
| PRD-066 | Pending dates do not trigger reminders | Must | R-C5, D-C3 | Scheduler test |
| PRD-067 | Manual and agent edits go through one workspace service, with atomic writes per file and recovery of multi-file changes | Must | R-C6 | Code review; crash-injection test |
| PRD-070 | The same UI runs in a browser and in Electron | Must | R-S1 | Smoke test in both; release check R-V6 |
| PRD-071 | A single writer per workspace. A second instance cannot write | Must | R-S2 | Integration test |
| PRD-072 | The Electron renderer is sandboxed with context isolation and a minimal preload API | Must | R-S3 | Config test; review |
| PRD-073 | A packaged Windows build runs on a clean machine | Must | R-S4 | Release check R-V6 |
| PRD-074 | Provider profiles can be added, tested, selected and removed. An OpenAI-compatible endpoint is supported, and at least one free route is verified | Must | R-S5 | Recorded test against a real free route |
| PRD-075 | Capabilities are probed. The model is pinned per run. Errors are clear. Steps and retries are capped | Must | R-S6 | Unit tests; release check R-V5 |
| PRD-076 | Keys are held in OS-protected storage on desktop, or for the session only. They never reach the workspace, renderer storage, logs, the repository or the build | Must | R-S7, R-S8 | Secret-scan test over the workspace, logs and package |
| PRD-080 | Keyboard operation, visible focus and reduced-motion support throughout, including review | Must | R-D-A, R-V6 | Keyboard-only review run; axe checks |
| PRD-090 | A free judge route, the sample workspace, reproducible instructions, and labels on any fixture or replay | Must | R-D-E, R-E3 | Clean-setup rehearsal |
| PRD-091 | **To be resolved before release:** a team-provided evaluation route lets judges try the live AI workflow free of charge. It must not bundle a private key in the distributable. A judge's own key is a second option. A replay does not satisfy this requirement | Must | R-D-E, DEC-014 | A recorded live run through the chosen route, made from a clean setup |
| PRD-092 | The browser launches from a fresh session through a single-use launch code. An unauthenticated client cannot read workspace data, mutate it or open the event stream. Tokens never appear in query strings or logs | Must | R-S1, R-S7, DEC-011 | Automated tests for a fresh launch, a reused code, a missing token, a wrong `Host` header, and a scan of the logs |

## 8. Demonstration workspace

`samples/meeting-workspace/` is entirely fictional and is reused by the
wireframe fixtures, the end-to-end tests and the video (R-V1).

- `meetings/2026-11-24 kickoff.md`: a note with headings for Decisions and
  Actions, and a checklist recording that Will and Hein agreed to (a) build
  the calendar view, owned by Hein, and (b) write the judge instructions,
  owned by Will.
- Project `NEX`: the board holds `NEX-1` "Build calendar view" (In progress,
  linked to the Actions heading). The judge-instructions task is missing.
- The demo asks what is outstanding, then asks Nexus to tick the agreed
  item, add `NEX-2` and set dates. The user rejects one proposed date,
  explains why, accepts the corrected date, and the `NEX-2` reminder opens
  the task.

## 9. Acceptance evidence

The release checks R-V2 to R-V6 are mandatory and are recorded in
`docs/submission-checklist.md`. Each check stores its evidence: a test run, a
screenshot, file contents or a journal entry. Automated evidence:

- **Unit and property tests** (Vitest, fast-check): the review journal's
  apply, reverse and conflict logic, scheduler deduplication and time
  zones, schemas and the citation validator.
- **Integration tests:** the workspace service against a temporary folder,
  including crash injection and restart, external edits, the lock, and
  reminders under a fake clock.
- **End-to-end tests** (Playwright): journeys J1 to J8 in the browser, and an
  Electron smoke test.
- **Manual checks:** a packaged Windows run on a clean profile, a
  keyboard-only review, and recorded runs against a real free provider.

Fixtures and replays are labelled wherever they appear, and never count as
`FEATURES.md` evidence for AI behaviour (R-D-A, R-D-E).

## 10. Schedule

All dates are in 2026 and all times are UK time. Will and Hein each have at
most one active implementation slice at a time (R-T2).

| Dates | Will | Hein |
| --- | --- | --- |
| 24–25 Nov | PRD, first spec (B1), W4 tooling | Review the issue shape and review states; wireframe spec |
| 25–26 Nov | B1 workspace core | A wireframe (one-day time box) |
| 27–28 Nov | B5 change journal (fixed operations) | B3 board and calendar against fixtures |
| 28–29 Nov | B2 notes, B4 reminders | B3 completed against the real service |
| 29–30 Nov | C providers and read-only AI | Sample workspace, accessibility pass |
| 30 Nov–2 Dec | D agent edits and review | Demo journey, Playwright journeys |
| **1 Dec 20:00** | Kiro credit request deadline | |
| **2 Dec** | **Feature freeze** | |
| 3–4 Dec | E packaging, release checks | Video, write-up, rehearsal |
| **4 Dec 22:00** | **Submission closes.** Aim to submit by 18:00 | |

## 11. Open questions

| # | Question | Proposed answer | Owner | Decide by |
| --- | --- | --- | --- | --- |
| Q1 | Which free model route is actually usable with tool calling? | Keep the question open during slice C. Test the candidates listed in `techstack.md` live and record the results | Will | 30 Nov |
| Q5 | What is the team-provided evaluation route for judges (PRD-091)? Options include a hosted proxy with a team key and a strict quota, or a time-limited free key per judge | A relay with per-judge access codes is proposed (not built or tested) in `docs/judge-ai-route.md`. It must hold no private key in the distributable | Will | 1 Dec |
| Q2 | Should we enter any bonus categories? | Decide after the feature freeze | Will and Hein | 3 Dec |
| Q3 | Is runtime MCP worth building? | No, unless slice D finishes by 1 Dec | Will | 1 Dec |
| Q4 | Will judges get a signed Windows build? | No. Document the SmartScreen prompt and also offer the run-from-source route | Will | 3 Dec |

These intake questions are resolved: the first spec is B1 (DEC-010);
heading anchors use a slug plus the heading text (DEC-006); time zones are
handled as in `architecture.md` section 6; and the browser shows in-app
reminders only while the tab is open (PRD-043).
