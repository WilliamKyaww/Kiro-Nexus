# Decisions

Consequential choices only. Do not rewrite a decision; mark it superseded
and add a new one.

## DEC-001: Lean documentation layout with native Kiro specs

- **Status:** Accepted (Will, 2026-11-24)

**Context.** The workflow template has separate folders for checklists,
specs, planning and knowledge. Kiro specs already provide requirements,
design and an executable `tasks.md`.

**Decision.** Keep `docs/intake/`, `docs/PRD/`, `docs/journal/` and
`docs/reviews/`, plus one submission gate, `docs/submission-checklist.md`.
Each slice's tasks have one authoritative checklist: its
`.kiro/specs/<slice>/tasks.md`. `BACKLOG.md` links to specs.

**Alternatives.** Keep every template folder (familiar, but duplicates
specs and invites drift).

**Revisit when** a recurring need appears that no spec or existing file
covers.

## DEC-002: Minimal steering before the PRD

- **Status:** Accepted (Will, 2026-11-24)

**Decision.** Two always-included steering files now: `workflow.md` (embeds
`STATE.md` by reference) and `source-boundaries.md`. Foundation steering
(`product.md`, `tech.md`, `structure.md`) is added after the PRD and links to
`docs/PRD/` with `#[[file:...]]` rather than copying it.

**Alternatives.** Generate foundation steering from the intake now (would
need rewriting once the PRD changes defaults).

## DEC-003: Rules reference and verification

- **Status:** Accepted (Will, 2026-11-24)

**Context.** The live Devpost pages return HTTP 403 to Kiro's fetcher.

**Decision.** Use the saved rules page as the local reference, cite
<https://kiroween.devpost.com/rules>, record Codex's live check of 24
November 2026, and recheck the live rules as a submission-checklist item.

**Alternatives.** Pasting the live text into chat (more manual, no added
assurance given the Codex check).

**Revisit when** the live rules show an update date after 16 November 2026.

## DEC-004: Automatic local commits at verified milestones

- **Status:** Accepted (Will, 2026-11-24). Replaces the earlier rule that
  every Git action needs a separate request.

**Context.** A separate approval for every commit slows down handoffs.
Unreviewed work in the working tree is also easy to lose between sessions.

**Decision.** After each completed and verified major update, the agent
creates a local Conventional Commit without asking again. A completed PRD,
feature, substantive fix or workflow change qualifies. The agent stages only
the relevant files by name, reviews the staged diff, uses the configured
identity, omits every AI co-author or attribution trailer, and reports the
short hash. Pushing and any other change to a remote still need an explicit
request.

**Alternatives.**
- Ask before every commit. This is the safest option, but it is slower.
- Commit after every task. This creates noisy history and commits
  unverified work.

**Consequences.** History records verified milestones. Mistakes stay local
and can be fixed with a new commit, never by rewriting history.

**Revisit when** a commit includes unrelated or unverified work, or Will
changes the policy.

## DEC-005: One local service as the single writer, shared by browser and Electron

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`). Session details amended by DEC-011.

**Context.** The same UI must run in a browser and in Electron (R-S1), with
a single writer for each workspace (R-S2).

**Decision.** A Node service owns all workspace reads and writes, takes
`.nexus/lock`, and serves the UI and a JSON and SSE API on `127.0.0.1`.
Every request must carry a bearer token that is created fresh each time the
service starts. Electron runs the service in `utilityProcess` and loads the
UI from the service. See `docs/PRD/architecture.md` sections 1 and 4.

**Alternatives.**
- Electron IPC only. This would make the browser route impossible.
- Writing through the browser File System Access API. Behaviour differs
  between browsers, the browser and desktop builds would need two writers,
  and Node cannot share the code.

**Consequences.** One code path for manual and agent edits (R-C6). The
loopback API needs hardening: a token, a host-header check and no CORS.

**Revisit when** a requirement calls for remote or multi-user access.

## DEC-006: Workspace data layout and anchoring

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`)

**Decision.**
- Structured data lives in `.nexus/*.json`. Each file has a
  `schemaVersion`, and every record has a stable prefixed ULID and a
  revision counter.
- A note's revision is the SHA-256 hash of its content. Nexus never writes
  metadata into notes.
- A link to a heading stores the note path, the heading slug and the heading
  text, and is resolved in that order. Nothing is added to the user's
  Markdown to mark a heading.

**Alternatives.**
- Front matter IDs or block IDs (`^id`) in notes. These are more robust, but
  they change files the user owns.
- One file per issue. This gives cleaner diffs, but many more files to keep
  atomic.

**Revisit when** a heading rename breaks links often in testing.

## DEC-007: Write-ahead review journal with region-level reversal

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`). Recovery data amended by DEC-012.

**Decision.**
- Validate the operations, then journal them as `prepared`, then write each
  file atomically, then mark the changes `pending`.
- On recovery, roll forward if the file is still at its base revision, and
  mark the change `conflicted` if neither the base nor the expected result
  matches.
- Reject reverses one change by checking only that change's region, either
  a field or a block's exact text, so other edits to the same file do not
  block it.
- Conflicts keep the newer work by default.
- Rejecting a change also rejects the changes that depend on it, after the
  user confirms.

See `architecture.md` section 7.

**Alternatives.**
- A shadow copy, with writes made only on accept. This is simpler, but
  breaks R-C2, which requires the change to be written to the real file.
- Git-based staging. This requires Git in the user's workspace.
- Treating the whole file's revision as the condition for rejecting a
  change. This is too strict: any unrelated edit to the file would block the
  rejection.

**Revisit when** property tests find a reversal that cannot be expressed per
region.

## DEC-008: Authority comes from an explicit Ask/Edit mode

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`)

**Context.** R-A2: a question authorises reading, and an explicit edit
request authorises tentative changes.

**Decision.** The composer's mode decides which tools a run receives, and
the model's interpretation of the message never does. A suggestion made in
Ask mode can be turned into an Edit run with one click.

**Alternatives.** Let the model classify the user's intent. It is ambiguous,
and the classification could be steered by injected note text.

**Revisit when** user testing shows that the mode switch causes errors.

## DEC-009: Reminders are delivered at most once, using a delivery log

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`)

**Decision.**
- Each reminder has a dedup key made of the target, the rule and the
  scheduled instant.
- The scheduler writes `delivering` to the log before it emits the
  reminder, and `delivered` after.
- An entry left at `delivering` after a crash is shown in the summary of
  missed reminders and is not sent again.
- Reminders are computed only from accepted values.

**Alternatives.** At-least-once delivery. This can produce a duplicate
after a crash, which breaks R-R3 and R-V5.

## DEC-010: Slice B is split, and the first spec is B1 workspace core

- **Status:** Accepted (Will, 2026-11-24, PRD approval at `7b775cd`)

**Decision.** Slice B becomes five specs:

| Spec | Scope |
| --- | --- |
| B1 `workspace-core` | Service, schemas, lock, atomic writes, a note and a linked issue persisting across a restart, a minimal UI, and a smoke test in the browser and Electron |
| B2 `notes` | The full notes feature set |
| B3 `board-calendar` | The board and the calendar (Hein) |
| B4 `reminders` | Reminders |
| B5 `change-journal` | The change journal, exercised with fixed operations, and the review UI |

B1 is specified first because every other slice depends on it, and because
R-D-B asks for persistence early.

**Alternatives.** One large spec for B. Its tasks would be too big to run as
bounded steps, and Hein could not work in parallel.

## DEC-011: Browser session through a launch code in the fragment and a bearer token

- **Status:** Accepted (Will's amendment 1, 2026-11-24). Kiro designed the
  details.

**Context.** The browser must load the app shell and start a session.
Workspace data, mutations and event streams must be protected, the service
must stay on loopback, and tokens must stay out of logs and query strings.

**Decision.** See `architecture.md` section 4.1 for the full design.

- The static shell is served without authentication and holds no workspace
  data.
- Only the launching process can mint a single-use launch code, using a
  control secret kept in the profile directory. The code travels in the URL
  fragment and is exchanged through a POST body for a session token. The UI
  keeps that token in `sessionStorage`.
- Every API route requires `Authorization: Bearer`. Live updates use a
  `fetch` stream so that the header is kept.
- The service checks the `Host` header and sends no CORS headers.

**Alternatives.**
- *A token in the fragment for the whole session (the original PRD).* It
  stays in browser history.
- *An HttpOnly cookie.* Cookies do not separate localhost ports, so another
  local web app could make requests that carry the cookie.
- *A token in the query string.* It leaks into logs.

**Revisit when** Nexus needs access from another device.

## DEC-012: The journal stores per-file hashes and stable operation IDs for recovery

- **Status:** Accepted (Will's amendment 2, 2026-11-24). Kiro designed the
  details.

**Context.** Recovery must be possible from the saved data alone. Each file
write is atomic, but a run that touches several files can stop with only
some of them written.

**Decision.** See `architecture.md` sections 7.2 to 7.5.

- Before any write, the journal stores, for every file, the hash before the
  run and the hash expected after it, with stable `opId` and `changeId`
  values.
- JSON is serialised deterministically, so the expected hash can be
  recomputed.
- A rejection persists `reversal.{beforeHash, afterHash}` before it writes.
- Recovery compares each file's current hash with the saved hashes. It then
  rolls the change forward, marks it done, or marks it `conflicted`.
- A note span is reversed by splicing only its own region, which is found
  through its exact text and its neighbouring lines. If the span is
  repeated or has been deleted, the result is a conflict and nothing is
  guessed.

**Alternatives.**
- *Storing the full before and after content of every file.* This is
  simple, but large for JSON collections, and it still needs hashes to
  detect external edits.
- *Rolling back the whole run on any failure.* This throws away changes the
  user can still usefully review.

**Revisit when** property tests find a sequence of changes that the span
model cannot reverse.

## DEC-013: Keep Node 24.14.0 and record what actually runs

- **Status:** Accepted (Will's amendment 3, 2026-11-24)

**Decision.**
- Develop on the installed Node 24.14.0, which meets every requirement of
  the selected toolchain (techstack section 1).
- Pin it in `.nvmrc` and `engines`.
- Check Electron's bundled Node separately and record both versions in
  `docs/toolchain.md`.
- System-wide upgrades are a human decision.

**Revisit when** a dependency drops Node 24, or Will decides to upgrade.

## DEC-014: The live provider route stays open, and a team route is a release requirement

- **Status:** Accepted (Will's amendment 4, 2026-11-24)

**Decision.**
- Slice C tests the free candidate providers live.
- A judge supplying their own key is one option.
- A team-provided evaluation route that bundles no private key is a release
  requirement (PRD-091, Q5).
- A scripted replay may demonstrate the interface, but is never evidence of
  live AI behaviour.

## DEC-015: Issue saves merge field by field

- **Status:** Accepted (Kiro, 2026-11-24, during Phase 1 repair 3 under
  Will's authorisation; awaiting human review)

**Context.** Two tabs editing one issue silently overwrote each other after
a live refresh. The form used the newest revision as its base, so the
server could not detect the conflict.

**Decision.**
- The form captures its editing base when the first field changes.
- `PATCH /issues/:key` takes `baseValues`. If the revision is stale, each
  patched field is applied when its current value still equals the base
  value, or already equals the new value. Otherwise it is a conflict,
  reported with theirs and yours.
- Without `baseValues`, a stale write is still refused outright.

**Alternatives.**
- *Refuse every stale save.* Safe, but annoying when two people edit
  different fields.
- *A last-write-wins model.* This caused the bug.

## DEC-016: Writes left after a failed write are "not attempted", never written on restart

- **Status:** Accepted (Kiro, 2026-11-24, Phase 1 repair 1; awaiting human
  review). Amends architecture section 7.3.

**Decision.**
- When a file write fails, the files after it are marked `failed`
  ("not attempted"), not left `planned`. Otherwise restart recovery would
  roll them forward without being asked.
- **Retry** re-plans the outstanding files against their current contents,
  and journals the new hashes before writing.
- **Discard** writes nothing.

## DEC-017: Ask is read-only by construction, and its answers are validated by the server

- **Status:** Accepted (Kiro, 2026-11-24, slice C under Will's
  authorisation; awaiting human review)

**Decision.**
- Ask runs receive a `ReadOnlyWorkspace` facade with no write methods, and
  only the tools `search_notes`, `read_note_section`, `query_issues` and
  `final_answer`. Any other tool call is refused and recorded.
- The service assigns citation handles for each run, removes unknown
  handles, demotes unsupported facts to suggestions, and computes the
  "Consulted" scope note itself.
- The only write an Ask makes is its conversation file.
- Repeatable tests use a deterministic, labelled test double. It is never
  evidence of live AI behaviour (DEC-014).

**Alternatives.**
- *Trusting the system prompt to keep the model read-only.* This fails
  under prompt injection.
- *Letting the model state its own coverage.* The model could overstate
  it.

## DEC-018: Tracking claims are structured and checked against the run's evidence

- **Status:** Accepted (Kiro, 2026-11-24, run 4 under Will's
  authorisation; awaiting human review)

**Decision.**
- An Ask answer carries each claim that an action is or is not tracked as
  a structured `tracking` entry.
- Nexus confirms an entry only when the evidence the run retrieved
  supports it:
  - the action is in a section the run read;
  - a tracked entry cites a related issue record, not just one linked to
    the same heading;
  - an untracked entry rests on every issue record.
- Nexus composes the visible sentence for each entry itself.
- In tool mode, Nexus reads the remaining issue records itself before it
  accepts an answer about issues.
- The phrase list that used to detect absence claims is removed.

**Alternatives.**
- *A longer list of English phrases.* Codex showed that it misses
  ordinary wording ("do not appear on the board"), and Will asked for the
  distinction to rest on evidence.
- *Reading every issue record for every question.* It costs a model step
  and free-tier tokens on questions that have nothing to do with issues.

## DEC-019: The first board uses native drag and drop with explicit keyboard moves

- **Status:** Accepted (Kiro, 2026-11-24, B3 first slice under Will's
  authorisation; open to Hein's revision)

**Decision.**
- Cards move between columns by native HTML drag and drop with the mouse.
- With the keyboard, a focused card moves with Alt+Left Arrow and
  Alt+Right Arrow, and each card also has a labelled status control. Each
  move is announced.
- Saves use the existing field merge, so only the status field is
  written.

**Alternatives.**
- *dnd-kit (the tech stack's choice).* It adds a dependency and a licence
  entry in Hein's area just before his design work. The data path does
  not change if he adopts it.

**Revisit when** Hein designs the final board, or touch support is needed.
Native drag and drop does not work with touch, so touch users use the
status control.

## DEC-020: Edit proposes typed operations through a callback, and Nexus fills every base value

- **Status:** Accepted (Kiro, 2026-11-24, run 4 milestone 5 under Will's
  authorisation). Revised by DEC-022 in run 5: proposals now reserve their
  issue keys, and an Edit note change is limited to the section the run read.

**Decision.**
- The user chooses Edit for one message at a time. After sending, the
  composer returns to Ask.
- An Edit run gets the Ask tools plus `propose_changes`, with four typed
  operations: `create_issue`, `link_issue`, `edit_note` and
  `update_issue`.
- Nexus maps them to journal operations, and takes base revisions and
  `before` values from the workspace, never from the model.
- The coordinator receives a `propose` callback from the route, never the
  review engine, so it has no accept, reject or other write path.
- Each run makes one successful proposal, in at most three attempts. An
  invalid proposal returns its reason to the model, and nothing is
  written.
- A new issue's key comes from the project counter and the keys already
  used. A review run does not write `projects.json`, so a rejected agent
  issue's key can be reused.
- Edit does not ask the user to save open drafts first. The existing
  outside-change banner keeps a draft (architecture 7.3, an open point
  until now).

**Alternatives.**
- *Letting the model supply base revisions and `before` values.* A stale
  or invented value could pass validation.
- *Passing the engine to the coordinator.* This would give the loop more
  authority than it needs.
- *Advancing `nextIssueNumber` for a proposed issue.* Rejection would then
  have to reverse two files, or leave a gap in the numbering.
- *Keeping Edit selected after a send.* A follow-up meant as a question
  could then write.

## DEC-021: A reviewer relay after every major update, sent by Will to Astra 6.2 in Codex

- **Status:** Accepted (standing instruction from Will, 2026-11-24)

**Decision.**
- After every major implementation or update, Kiro writes a reviewer
  relay: a self-contained message that Will pastes into the reviewer
  unchanged. "Major" is defined under "Reviews" in `AGENTS.md`. Minor
  changes and tweaks need no relay.
- The current reviewer is Astra 6.2 in the Codex extension, run by Will.
  The reviewer may change. `AGENTS.md` names the current one in a single
  line.
- Relays are saved in `docs/reviews/relays/` and committed. A relay is a
  request, not a review: the review record is written only after the
  report comes back, with the reviewer named as the tool and the person
  who ran it.
- The first relay covers run 4 (`4093fa1..50a6a8f`).

**Alternatives.**
- *Giving the relay in the chat only.* Nothing would then show what the
  reviewer was asked to check, which the review record and the submission
  write-up both need.
- *A review after every commit.* Too much for copy and styling changes.
  Will excluded minor changes.

## DEC-022: Proposals may not overlap open changes, reserve their keys, and journal group decisions

- **Status:** Accepted (Kiro, 2026-11-24, run 5 stage 1 under Will's
  authorisation; repairs R4-1, R4-2, R4-3, R4-7 and R4-9). Revises two points of
  DEC-020.

**Decision.**
- **Overlap.** A new proposal is refused when it targets a field that already has an
  open change, or note lines that an open change wrote or will write. It is also
  refused when it links to, updates or names an issue that is itself still a
  proposal. A manual edit is never refused.
- **Scope.** An Edit note change names the section the run read. It carries the hash
  of the text read, and may change only lines inside that section while the section
  still has that text.
- **Prerequisites.** A change is accepted only when each prerequisite stands in the
  files. A pending prerequisite is accepted with it after confirmation. A
  prerequisite that was never written, was rejected or is in conflict blocks it.
  Discard asks before undoing the written changes that need what it drops.
- **Keys (revises DEC-020).** A proposal reserves its new issues' numbers in
  `projects.json` before the journal is written, so a key is never given to another
  issue. A rejected proposal leaves a gap in the numbering, and its old link says it
  was rejected.
- **Group decisions.** A confirmed decision on several related changes is saved on
  each of them before the first is carried out. Recovery finishes it in order.

**Alternatives.**
- *Tracking chains of overlapping edits.* Each decision order and conflict choice
  would need its own reversal rules, which is the source of R4-2. Refusing the
  overlap is simpler, and the user decides the first change before proposing again.
- *Not writing `projects.json` from a review run (DEC-020).* This kept reversal to
  one file, but let a saved link open different work (R4-7).
## DEC-023: A timed due date belongs to its own zone, and the calendar shows it in the workspace zone

- **Status:** Accepted (Kiro, 2026-11-24, run 5 stage 1; repair R4-10)

**Decision.**
- An all-day due date is a local date in the workspace zone, as before.
- A timed due date keeps its own IANA zone. Editing its date keeps its local time in
  that zone ("23:30 London" stays 23:30 London).
- The date editor names the zone, and when it differs from the workspace zone, says on
  which day the calendar shows it.
- The calendar places each item on its day in the workspace zone, and shows a timed
  item's time in that zone.
- A local time that does not exist on the chosen day, because the clocks go forward,
  moves forward by the gap. Nexus says so before saving. A time that occurs twice when
  the clocks go back uses its first occurrence.

**Alternatives.**
- *Editing every date in the workspace zone.* Moving a London deadline would change
  its London time across a clock change, which is not what its owner set.
- *Refusing a time in a gap.* The forward shift is the common convention for
  calendars, and the notice makes it visible.
## DEC-024: Tracking needs strong evidence, prose cannot override it, and headings are aligned document-wide

- **Status:** Accepted (Kiro, 2026-11-24, run 5 stage 1; repairs R4-4 and R4-8).
  Refines DEC-018.

**Decision.**
- **Tracked.** A "tracked" entry is confirmed only for a strong match: most of the issue
  title's content words appear in the action, at least two of them unless the title
  has one. One shared word is a weak match, and is shown as not confirmed, with the
  word.
- **Untracked.** An "untracked" entry is not confirmed when a record the run read
  matches it, strongly or weakly, even with full coverage.
- **Prose.** When an answer gives tracking entries, a free-text fact about one of those
  actions is shown under "Not confirmed". Only Nexus's own sentences state tracking. A
  discrepancy about an action is kept when it cites the issue that tracks it.
- **Evaluator.** The live check fails any recorded statement about the journey's
  actions other than those sentences. It takes the journey as a scenario.
- **Headings.** The headings of two versions of a note are aligned across the whole
  document. Unchanged lines keep their identity, and a changed heading follows its
  section's body. Each decision records how slugs moved. An Ask citation names the
  accepted heading at the time of the answer, and follows later moves.

**Alternatives.**
- *Matching by meaning with a model.* That is not evidence that Nexus can check
  itself.
- *Matching by position or slug.* This is what broke on collisions and changed
  heading counts (R4-8).

## DEC-025: Reminders are computed each tick from accepted data, with a test clock behind the control secret

- **Status:** Accepted (Kiro, 2026-11-24, run 5 stage 2, B4 under Will's
  authorisation; awaiting human review). Builds on DEC-009.

**Decision.**
- **Computing reminders.** The scheduler keeps no schedule of its own. Each tick
  computes every occurrence from accepted issues, the events in `calendar.json`
  and the settings. It delivers those that came due since the last tick and have
  no log entry.
  - An accepted date, a manual edit or a changed setting therefore needs no
    rescheduling. A data change makes it tick within 250 ms.
  - Occurrences that came due while Nexus was closed are recorded as missed on
    the next start, in that start-up's batch. They are shown once, under "While
    you were away", and never delivered.
- **Defaults.** An all-day date reminds at 09:00 in the workspace zone. A timed
  due date or event reminds 60 minutes before. Both can be changed in Settings,
  per workspace.
- **Surfaces.** In-app notifications go to every tab over the event stream. The
  desktop app adds the native notification from the same delivery, over the
  `utilityProcess` port. Every surface opens a reminder through
  `/notifications/open`, which checks the workspace and the item first.
- **Test clock.** `NEXUS_TEST_CLOCK` freezes the clock for tests. Only the process
  that started the service can move it (`POST /api/v1/control/clock`, which
  needs the control secret). Without the variable the route does not exist.

**Alternatives.**
- *A persistent schedule, updated on every change.* It can drift from the data,
  and every change path would have to update it.
- *A clock route available to browser sessions.* Any page with a session could
  then trigger or suppress reminders.
- *Delivering missed reminders on start.* After a long absence that would flood
  the user, and it would show a reminder whose time had passed as if it were new.

## DEC-026: The wireframe proposes the category-standard look, with Impeccable's records at the repo root
- **Status:** Proposed (Will chose the direction on 2026-11-25; Hein has not
  seen it). Adoption by the app needs Will's go-ahead and Hein's agreement,
  because Hein owns the final visual identity.
**Decision.**
- **Look.** The wireframe uses the category standard: a cool grey shell with
  a floating white panel, one iris accent, amber only for changes awaiting
  review, and system UI type. The craft bar is Linear (board and issues),
  Notion or Obsidian (notes) and Temporal (calendar and shell), borrowing
  behaviours and no branding.
- **Records.** `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` and
  `.impeccable/surfaces/` are committed at the repository root, as Will
  asked. Impeccable's working folders (questions, mocks, review, shots)
  ignore themselves.
- **References.** The UI reference screenshots stay local in
  `docs/design/references/`, which Git ignores. The repository will be
  public, and some images are other companies' or come from Will's own
  apps.
**Alternatives.**
- *Impeccable's assigned roll ("Public-service plain") or its pick ("Galley
  proof").* Will preferred the familiar standard.
- *Committing the screenshots.* That would make them public permanently,
  because history is never rewritten here.

## DEC-027: Identity is proved, not assumed, in review and reminders (run-5 review repairs)
- **Status:** Accepted (Kiro, 2026-11-25, run 6 stage 1, under Will's overnight
  authorisation; awaiting human review). Refines DEC-012, DEC-022, DEC-024 and DEC-025.
  Record: `docs/reviews/2026-11-25-run5-review.md`.
**Decision.**
- **Spans.** A note change's span is its saved text plus at least one of its saved
  neighbouring lines. The same text elsewhere, with both neighbours different, is not the
  span (R5-1).
- **Edit scope.** An Edit may change only the raw lines a read returned, heading line
  included. A long section is read in parts with `fromLine` (R5-8).
- **Unlocated changes.** A change awaiting a decision whose lines cannot be found owns the
  lines between its neighbours. If even that is unknown, the note takes no new edit (R5-9).
- **Decisions.** A group decision is checked against the files before it is carried out,
  also by recovery. A missing target blocks Accept. An irreversible root makes the
  rejection a conflict and leaves its dependents pending (R5-2).
- **Keys.** Every key a journal ever proposed stays used, including in workspaces from
  before run 5 (R5-7).
- **Citations.** A citation keeps the first line it read. Where heading identity cannot be
  reconstructed, the link says so rather than guessing (R5-10).
- **Reminders.**
  - Only a missing delivery log means first use. A damaged log stops delivery until it is
    repaired, or replaced on request with a time boundary.
  - `prunedUpTo` stops a clock change from repeating a pruned delivery.
  - Records are validated one at a time, and a bad one is reported without stopping the
    others.
  - A stopped scheduler delivers nothing (R5-4 to R5-6, R5-13).
**Alternatives.**
- *Keep accepting a sole occurrence.* That is how R5-1 rewrote another paragraph.
- *Require both neighbours to match.* Any edit to an adjacent line would then turn a
  reversal into a conflict.
- *Treat an empty log as new.* It risks repeating deliveries, which DEC-009 forbids.