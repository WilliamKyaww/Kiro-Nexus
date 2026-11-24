# Design: the first Ask → Edit → Review journey

## Overview

Edit reuses the Ask coordinator loop and the B5 review engine. The new
parts are one tool definition, a mapper from the model's operations to
journal operations, three new change kinds in the engine, and the review
UI for dependencies.

```
Composer (mode: edit) ─► POST /conversations/:id/ask { question, mode }
                              │
                              ▼
                 runAsk({ authority: "edit", propose })
                   tools: search_notes, read_note_section,
                          query_issues, final_answer, propose_changes
                              │ propose_changes(ops)
                              ▼
          toProposedOperations(ops, ReadOnlyWorkspace)   (server/src/ask/edit.ts)
            base revisions and before values from the workspace
                              │ ProposedOperation[]
                              ▼
          propose callback (routes.ts) ─► ReviewEngine.propose({ kind: "agent", label })
            journal first, then the note and issues.json writes (architecture 7.3)
```

## Authority (Requirement 1)

- `AskRequest.mode` defaults to `"ask"`. `askAvailability` reports
  `edit.available` only when the profile has shown tool calling.
  `startRun` refuses Edit for any other profile before storing the
  question.
- `runAsk` offers `PROPOSE_TOOL` only when `authority === "edit"` and a
  `propose` callback is given. The coordinator never holds the engine: the
  route passes a callback that can only call `ReviewEngine.propose`. There
  is still no accept, reject, file, shell or network tool.
- The Edit system prompt replaces the two read-only lines of the Ask prompt
  and adds `EDIT_SYSTEM`. It tells the model that it cannot accept changes
  and must not claim that they are done. Enforcement does not depend on
  the prompt.

## Operations (Requirement 2)

| Model operation | Journal operation | Filled by Nexus |
| --- | --- | --- |
| `create_issue { ref, project, title, description?, priority? }` | `record.create` | the key, ID, rank and timestamps (engine) |
| `link_issue { issue, note, heading }` | `record.addLink` (`issueRef` or `recordKey`) | the base revision of an existing issue; the heading text (engine) |
| `edit_note { note, before, after }` | `note.replaceSpan` | `baseRevision` (the note's SHA-256) |
| `update_issue { issue, field, value }` | `record.updateField` | `baseRevision` and `before` |

- opIds are `op-<askRunId>-<attempt>-<n>`, unique per run.
- `{{issue:<ref>}}` in `after` is rewritten to `{{issue:<opId>}}`. The
  engine replaces it with the new key and records the dependency.
- The engine validates everything before writing anything: the project,
  the note and heading, whole-line spans, and base revisions. Any error
  rejects the whole proposal (`VALIDATION` with per-operation reasons),
  which goes back to the model as a tool result.
- Each run makes one successful proposal and at most three attempts.
- Keys: `max(nextIssueNumber, highest used + 1)`. A rejected agent issue's
  key may be reused later, because `projects.json` is not written by a
  review run. This keeps the reversal to a single file.
- `effectiveAcceptedIssues` drops pending created issues and pending added
  links. `query_issues` lists pending new issues separately as
  `proposedIssues`.

## Review (Requirement 3)

- **Opening the first change.** `useAsk` remembers the Edit run IDs it
  started in this tab. When the conversation shows such a run finished,
  the page navigates once to `changeUrl(first change)`, with
  `from=/c/<id>` for the way back. This works however quickly the run
  finishes.
- **Highlighting.**
  - The note page already highlights `?change=`.
  - The issue page highlights a field change on its field, a new link on
    its row under "Linked notes", and a new issue on its review notice.
  - `IssuePending` describes create and link changes, with the labels
    "Accept new issue" and "Reject new link".
- **Dependencies.**
  - The engine refuses `accept` with CONFLICT
    `{ reason: "needs-dependencies", changes }`, and `reject` with
    `{ reason: "has-dependents", changes }`.
  - The review bar turns that refusal into a confirmation that lists the
    changes, with **Accept both** or **Reject all N**, and **Cancel**. It
    then retries with `?withDependencies=1` or `?withDependents=1`.
  - Rejection undoes the dependents first, so the note line loses
    "(NEX-2)" before the issue disappears.
- **Reversal.**
  - `record.create` is removed only while the issue is unchanged since it
    was proposed. Otherwise the change is conflicted (`changed`), and the
    newer work is kept.
  - `record.addLink` removes that one link.
  - Note spans use the existing locate-and-splice.
  - Conflicted dependents are closed as rejected, and their own journal
    is saved.
- **After rejecting a new issue,** the page moves to the project board,
  because the issue no longer exists.
- **Conversation.** The `EditCard` lists the proposed changes with their
  live state (from `/review/changes?state=all`). Each open change links to
  its target. The stored message keeps `authority` and `edit`, both
  optional, so older conversation files still load. A run that fails after
  proposing still records what it proposed.

## Drafts

Architecture 7.3 left open whether to ask the user to save open drafts
before an Edit run. This slice does not ask. When a change lands on a note
with an unsaved draft, the existing banner keeps the draft and offers
"Load the new version (discard mine)" or "Compare and choose", as for the
fixed demo.

## Testing

- `server/src/review/create.test.ts` (engine):
  - all three changes written;
  - rejection needs confirmation and then undoes all three;
  - accepting with dependencies;
  - a hand-edited new issue is kept as a conflict;
  - recovery after a restart and after a crash;
  - unknown references are refused.
- `server/src/ask/edit.test.ts` (coordinator, with the test double):
  - the three pending changes, their dependencies and the source label;
  - Ask ignores the pending issue until it is accepted, then finds NEX-2;
  - Ask is never offered the write tool;
  - Edit is refused without tool calling;
  - an invalid proposal writes nothing;
  - base values come from the workspace.
- `tests/e2e/c5-edit-journey.spec.ts` (browser):
  - the full journey with Accept both, then a read-only Ask;
  - rejection with confirmation after a restart, keeping a manual edit.
