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
