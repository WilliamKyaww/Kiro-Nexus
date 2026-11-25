# Requirements: the first Ask → Edit → Review journey (one J7 slice)

## Introduction

From the grounded kickoff answer (J6), the user explicitly switches the
composer to Edit and asks Nexus to create the missing issue, link it to
its source heading and update the note line. Nexus writes the three
changes tentatively through the existing review journal. The user reviews
each one, with dependencies respected, and the files end up holding
exactly what was accepted.

This is the first slice of slice D (agent edits). Will authorised it on
2026-11-24 as milestone 5 of run 4. New notes, block insertions and
"Restore original" are not in this slice. Will authorised the correction
loop (Requirement 5) on 2026-11-25 as stage 3 of overnight run 6.

- **Traces to:**
  - J7 (structure section 4), in part: the checklist edit and the new
    task, without the rejected-date correction loop;
  - PRD-050 and PRD-051 (`propose_changes` in Edit only; no accept path for
    the agent);
  - PRD-060 to PRD-063 and PRD-065 (journal before write, real files,
    first change opened and highlighted, per-change decisions,
    dependencies, restart recovery);
  - PRD-067 (one workspace service for manual and agent edits);
  - architecture sections 4.3, 7.1 to 7.5 and 9.
- **Approval:** written and self-reviewed by Kiro under Will's
  authorisation (run 4). Human review is pending.

## Requirements

### Requirement 1: Authority comes from the user's choice

1. The composer SHALL offer Ask and Edit. Edit SHALL be chosen explicitly,
   for one message at a time. After an Edit message is sent, the composer
   SHALL return to Ask.
2. WHEN the selected model has not shown tool calling, Edit SHALL be
   unavailable with a reason, and the service SHALL refuse an Edit request
   before anything is sent to the provider or written.
3. Ask runs SHALL NOT receive `propose_changes`. A call to it in an Ask
   run SHALL be refused and recorded, and nothing SHALL be written.
4. Edit runs SHALL receive the Ask tools plus `propose_changes`. No tool
   SHALL accept, reject, read files directly, run commands or reach the
   network.

### Requirement 2: Typed operations through the existing journal

1. `propose_changes` SHALL take typed operations: `create_issue`,
   `link_issue`, `edit_note` and `update_issue`.
2. Nexus SHALL take base revisions and current values from the workspace
   at proposal time, never from the model.
3. A note edit SHALL be able to name an issue created in the same proposal
   (`{{issue:<ref>}}`). A link SHALL be able to target such an issue.
4. The proposal SHALL become one review run: a `record.create` change, a
   `record.addLink` change and a `note.replaceSpan` change. The link and
   the note change SHALL depend on the new issue.
5. An invalid proposal SHALL be returned to the model with the reason, and
   nothing SHALL be written. A run SHALL make at most one successful
   proposal.
6. A new issue awaiting review SHALL NOT count as an accepted record for
   Ask or for reminders (architecture 7.7). Its key comes from the
   project's counter and existing keys, and `projects.json` is not
   written.

### Requirement 3: Review

1. WHEN the Edit answer arrives, the UI SHALL open the first change and
   highlight it, once per run.
2. Each affected item SHALL open highlighted from the review bar and from
   the answer's list of proposed changes: the note line on the note page,
   and the new issue and its link on the issue page.
3. Each change SHALL have its own Accept and Reject.
4. Accepting a change that depends on a pending change SHALL ask first,
   then accept both ("Accept both").
5. Rejecting a change that others depend on SHALL list them and ask first,
   then reject and undo all of them (PRD-063).
6. Rejection SHALL reverse only each change's own region, so an unrelated
   manual edit to the same note is kept. A new issue that was edited after
   it was proposed SHALL become a conflict rather than be deleted.
7. Pending changes SHALL survive a restart and stay decidable.
8. The answer SHALL label its source. A test-double run SHALL say "test
   double, not AI" in the review bar and on the answer.

### Requirement 4: Evidence

1. The journey SHALL be verified end to end with the labelled test double
   on a fictional workspace, in the browser, with the files and the
   journal checked.
2. Test-double runs SHALL NOT be presented as evidence of live model
   behaviour. Live Edit behaviour stays unverified until a real free
   provider has run it.

### Requirement 5: The correction loop (run 6, stage 3; PRD-064, architecture 7.4)

**User story:** As a user who rejected one change, I want to say what was wrong and get a
corrected change on the same target, so that I can fix it without starting again.

1. WHEN the user rejects a change, THEN the review bar SHALL ask "What was wrong, or what
   should be kept?" with **Send reason** and **Skip**. Skip SHALL change nothing more.
2. WHEN the user sends a reason for a rejected Edit change to an issue field or to note
   lines, THEN Nexus SHALL save the reason in the journal before anything else, and start a
   correction run in Edit mode, in the change's conversation. The run SHALL be given the
   rejected change, its target and the reason.
3. The correction run SHALL be bound to the workspace it started in, to the rejected change
   and to its target: the same field of the same issue, or the note lines the rejected change
   covered. Nexus SHALL refuse any other operation, and write nothing for it.
4. The new change SHALL carry `supersedes` with the rejected change's ID, and the rejected
   change SHALL become `superseded`, only once the new proposal is written to the journal.
   The new change SHALL appear on the disputed target for an ordinary Accept or Reject.
5. Accepted changes and manual edits SHALL be kept: the correction's base value is the
   target's current value.
6. Sending the same reason twice, or from two tabs, SHALL start at most one correction run.
7. WHEN the correction run fails, is interrupted by a restart, or proposes nothing, THEN the
   reason SHALL stay saved, the review bar SHALL say what happened, and offer **Retry
   correction** and **Keep it rejected**.
8. Rejecting a correction SHALL start the loop again, without limit.
9. A rejected fixed-demo change, new issue or new link SHALL keep its reason only. Nexus
   SHALL say that it saved the reason.
