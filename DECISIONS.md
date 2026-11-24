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
