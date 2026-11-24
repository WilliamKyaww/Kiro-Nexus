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
