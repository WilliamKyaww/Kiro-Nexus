# Design: B5 change journal

- **Traces to:** `requirements.md` and `docs/PRD/architecture.md` sections
  7.2 to 7.7.
- **Review:** Kiro self-review only (see the end of this file).

## Modules

| Module | Responsibility |
| --- | --- |
| `packages/schema` (`review.ts`) | The journal schema (`ReviewRun`, `Change`, `FileEntry`) and the proposal operation schema |
| `server/src/review/spans.ts` | Pure line-aligned span logic: locate a span with its context, splice, and capture context. It has no I/O and is property-tested |
| `server/src/review/records.ts` | Pure field updates on `IssuesFile`, with deterministic timestamps |
| `server/src/review/engine.ts` | `ReviewEngine`: propose, accept, reject, keep-current, feedback, recover and list. It does all I/O through `WorkspaceService` (`exclusive`, `writeNoteUnlocked` and `writeCollectionUnlocked`), so manual and agent edits share one writer (R-C6) |
| `server/src/review/routes.ts` | HTTP routes, and the fixed demo operations |
| `server/src/scheduler/reminders.ts` | `effectiveAcceptedIssues` and `dueReminders`, the minimal B4 seam used to prove PRD-066 |
| `apps/web/src/review/*` | The review bar overlay, hooks for pending markers, and the demo button on Home |

## Operations (proposal format)

```ts
{ opId, kind: "note.replaceSpan", file: "<note path>", before: "<whole lines>", after: "<whole lines>" }
{ opId, kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1",
  field: "due" | "status" | "priority" | "title" | "description", baseRevision, before, after }
```

Span text is a run of whole lines. A trailing newline is added if it is
missing, and CRLF files are handled by matching after normalising to LF.
The original line endings are kept when writing. `note.insertAfter`,
`record.create`, `note.create` and `dependsOn` are deferred to the agent slice (D). The
journal schema already reserves their fields.

## Deterministic recomputation

- A note change is recomputed by applying each of the run's changes for
  that file, in order, to the file's `before` content.
- A record change uses the run's `createdAt` as `updatedAt`, and a
  reversal uses `reversal.at`. Serialisation is deterministic
  (`serialise`).
- Recovery can therefore recompute an expected result and check it against
  the saved hash before writing.

## Span location

Each change saves `context = { lineBefore, lineAfter }`, the nearest
non-blank lines around the span at proposal time.

To locate `text` in `content`, the engine:

1. Finds every line-aligned occurrence of `text`.
2. If there is exactly one occurrence, uses it.
3. If there are several, keeps those whose neighbours equal the context.
   Exactly one remaining occurrence is used. Otherwise the result is
   `ambiguous`.
4. If there are none, the result is `missing`.

An empty `after` (a deletion) is located by its two context lines, which
must be adjacent and unique.

## Correctness properties (property-based, fast-check)

1. **Round trip:** for any document and any uniquely located span,
   replacing it with `after` and then reversing restores the original bytes.
2. **Isolation:** two changes in the same file, made to different unique
   spans: rejecting one leaves the other's `after` text in place, and every
   line outside both spans is unchanged.
3. **Unrelated edits survive:** after a change is applied, the user edits a
   line outside the span. Rejecting the change keeps that edit.

## Fixed demo operations

These apply to the sample workspace and are labelled
"Demo operations (fixed, not AI)":

1. In `meetings/2026-11-24 kickoff.md`, change
   `- [ ] Hein builds the calendar view` to `- [x] …`.
2. Change `NEX-1`'s due date from `2026-12-05` to `2026-12-03`.

If the targets are not present, the run fails validation with a clear
message, and nothing is written.

## UI

- **Review bar.** It shows "Change n of m · source label · target", with
  Previous, Next, Accept and Reject. Moving to a change navigates to
  `/notes?path=…&change=<id>` or `/issues/<key>?change=<id>`.
- **Notes.** The preview tags list items and paragraphs with their source
  lines. The server returns each pending change's current line range, and
  the matching elements get a "Pending review" marker.
- **Issues.** A pending field shows its before and after values with
  Accept and Reject next to the field.
- **Rejection.** A rejection shows an inline feedback form with Send and
  Skip.
- **Conflicts.** A conflict shows its reason and "Keep current".

## Effective accepted values (implemented rule)

For each field that has an unsettled change, the scheduler uses the
change's `before` value **only when the field still holds the proposed
`after`**. If someone has edited the field by hand since then, the newer
value stands. This refines D-C3: a proposal is never scheduled, and manual
work is never ignored.

## Self-review (Kiro, 2026-11-24)

- **Changed during review.** The first draft used one field-level hash of
  the whole file as the reject precondition. That contradicts DEC-012
  (unrelated edits must survive), so I replaced it with region checks plus
  per-file hashes, which are used only for recovery.
- **Residual gap.** "Restore original" for an ambiguous conflict needs the
  user to pick an occurrence, and is deferred. Tonight only "Keep current"
  is offered.
