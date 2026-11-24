---
inclusion: always
---

# Nexus workflow

`AGENTS.md` holds the standing instructions and the development loop. This
file brings the live project state into every session so that a fresh agent
starts from the current phase. If they conflict, `STATE.md` is authoritative.

## Current state

#[[file:STATE.md]]

## Working rules for Kiro

- Use native Kiro feature specs in `.kiro/specs/<slice-name>/`, with
  `requirements.md`, `design.md` and `tasks.md`. Stop at each review point
  (requirements, then design, then tasks) until Will or Hein approves.
- `tasks.md` is the only checklist for a slice's tasks. `BACKLOG.md` links to
  specs and does not repeat their tasks.
- For product questions, read `docs/intake/2026-11-24-product-brief.md`, and
  `docs/PRD/` once it exists. Labels in the intake matter: `R-*` items are
  Will's requirements and `D-*` items are proposals that can change.
- Ask before going beyond the authorised scope in `STATE.md`.
- After every major implementation or update, end the handoff with a
  reviewer relay for Will to paste into the current reviewer (Astra 6.2 in
  the Codex extension). Save it in `docs/reviews/relays/`. Minor changes
  and tweaks do not need one. The rules are under "Reviews" in `AGENTS.md`
  (DEC-021).
- When a spec, steering file or hook changes a decision or catches a defect,
  record it briefly in that day's `docs/journal/` note. The submission
  write-up needs this evidence.
