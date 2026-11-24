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

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

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

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

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

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

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

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

**Context.** R-A2: a question authorises reading, and an explicit edit
request authorises tentative changes.

**Decision.** The composer's mode decides which tools a run receives, and
the model's interpretation of the message never does. A suggestion made in
Ask mode can be turned into an Edit run with one click.

**Alternatives.** Let the model classify the user's intent. It is ambiguous,
and the classification could be steered by injected note text.

**Revisit when** user testing shows that the mode switch causes errors.

## DEC-009: Reminders are delivered at most once, using a delivery log

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

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

- **Status:** Proposed in the PRD (2026-11-24), awaiting Will's approval

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
