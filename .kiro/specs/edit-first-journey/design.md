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
- Keys: `max(nextIssueNumber, highest used + 1)`. The proposal reserves
  that number in `projects.json` before the journal is written, so a
  rejected agent issue's key is never given to another issue (DEC-022,
  repair R4-7; this replaces the first design, which reused keys).
- Note edits are scoped (DEC-022, repair R4-1). `edit_note` names the
  section the run read. Nexus sends the section's heading on disk and the
  hash of the text read, and the engine matches the lines only inside that
  section while it still has that text.
- Proposals may not overlap open changes, or build on an issue that is
  still a proposal (repairs R4-2 and R4-9).
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

## The correction loop (Requirement 5, run 6 stage 3)

```
Reject ─► review bar: "What was wrong, or what should be kept?"  Skip │ Send reason
                                                                       ▼
POST /review/changes/:id/feedback { text }   (server/src/ask/correction.ts)
  1. engine.feedback: the reason is saved in the journal
  2. not correctable (demo, new issue, new link) ─► done: "reason saved"
  3. engine.beginCorrection(changeId, askRunId): correction.state = running   (once only)
  4. startRun(mode edit, correction): the visible question and the correction prompt
       propose ─► scope check (same target) ─► engine.propose(…, { supersedes })
                    new run journaled with supersedes ─► old change superseded
  5. no proposal ─► correction.state = no-change; failure ─► failed (reason kept)
```

### Data

- `ChangeRecord.correction` (optional, so older journals load):
  `{ state: running | proposed | no-change | failed | dropped, askRunId, conversationId, at, message }`.
  It lives on the rejected change, in its own journal, so the reason and the state survive a
  restart together.
- `ChangeView` adds `supersedes`, `supersededBy`, `correctable`, `conversationId` and
  `correction`. `GET /review/changes?state=corrections` lists rejected changes whose
  correction is running, failed or proposed nothing.
- A change is **correctable** when its run came from an Edit conversation and it is a field
  change or a note-lines change. New issues and links keep the reason only: their correction
  would need a new issue or a new link, which is a later slice.

### Engine

- `feedback` saves the reason. While a correction is running or proposed, it changes nothing,
  so a second send cannot swap the reason under a running correction.
- `beginCorrection` starts a correction only for a rejected change with a reason and no
  running or proposed correction. It is the single point that prevents duplicates; the route
  also holds a synchronous per-change admission set, so two simultaneous sends cannot both
  reach it.
- `propose(…, { supersedes, correctionRunId })` refuses unless that change is still rejected
  and its running correction is this run. Every new change carries `supersedes`. After the
  new run's journal is written and applied, the old change becomes `superseded` and its
  correction `proposed`, in its own journal.
- `endCorrection` records `no-change` or `failed` with the message, only for the same run.
  `dropCorrection` ("Keep it rejected") closes a failed or empty correction.
- **Recovery:** a rejected change that a written change supersedes becomes `superseded` (a
  crash between the two journal writes). A correction still `running` after a restart becomes
  `failed`: "Nexus stopped before the correction finished".

### The correction run

- It runs in the rejected change's conversation, in Edit mode, with the normal limits, and
  takes that conversation's one-question slot. A busy conversation records a failed
  correction with a reason to retry.
- The conversation shows "Correct “<summary>”: <reason>". The model receives the summary,
  the reason as the user's own words, the target, its current value, and a
  `CORRECTION_REQUEST_JSON` block with the same facts.
- **Scope.** Before anything reaches the engine, every operation must target:
  - for a field change, the same field of the same issue (`record.updateField`);
  - for a note change, the same note, on lines that overlap where the rejected change's
    original lines now are. If those lines cannot be found, the correction is refused.
  A refusal goes back to the model as a tool error, and nothing is written.
- Base values come from the workspace, as for every Edit, so a manual edit or an accepted
  change made since is the correction's `before`.
- The workspace binding of Edit (R4-6) applies unchanged.

### Review UI

- After a rejection the bar stays on the rejected change's page until the reason is sent or
  skipped, so the next change's page does not take focus from the question. Skip, or a
  reason that starts no correction, then moves on to the next change. A rejected new issue
  still opens its project's board, because its page is gone.
- After **Send reason**, the bar says Nexus is preparing a corrected change. When a change
  that supersedes it appears, the tab that sent the reason opens it on its target,
  highlighted, once.
- The bar lists corrections that are running, failed or empty, with **Retry correction**
  (`POST /review/changes/:id/correction`, using the saved reason) and **Keep it rejected**
  (`POST /review/changes/:id/correction/drop`). After a restart they are listed the same way.
- A correction in the bar is labelled "Correction" next to its summary.

### Provider double (a labelled fixture, not AI)

- Edit: a question that names an issue and a due date ("set NEX-1 due on 3 December") adds
  that `update_issue` to the fixed plan.
- Correction: the double reads `CORRECTION_REQUEST_JSON`. For a due date it looks the issue
  up, takes the date the reason names, proposes it and answers citing the issue. If the reason
  names no date it proposes nothing and says so. `nexus-test-double-stray` proposes a
  different field, to prove the scope check.

### Testing

- `server/src/review/correction.test.ts` (engine): supersede only after the new journal,
  recovery after a crash between the two writes, running becomes failed after a restart,
  `beginCorrection` once only, the reason kept.
- `server/src/ask/correction-http.test.ts` (real service, double): a corrected date and its
  binding; two simultaneous sends start one run; a second rejection and a second correction;
  the provider down, then **Retry**; a stray proposal refused with nothing written; a demo
  change keeps the reason only.
- `tests/e2e/j7-correction.spec.ts` (browser): Ask, then Edit with a date; accept the new
  task, reject the date, send a reason; the corrected date opens on NEX-1; restart; accept;
  the files on disk; one reminder at 09:00 under the test clock, which opens NEX-1. A second
  test covers Skip, a failed correction after a restart, and **Retry correction**.
- Live Edit, including corrections, still needs its own run against a real free provider.