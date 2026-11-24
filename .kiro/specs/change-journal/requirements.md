# Requirements: B5 change journal (fixed operations)

## Introduction

B5 builds the engine that turns proposed workspace edits into real,
individually reviewable changes, plus a small review interaction. Tonight
the operations are **fixed and clearly labelled demo operations, not AI**.
Slice D connects the coordinator agent to the same engine.

- **Traces to:** PRD-060 to PRD-067; `docs/PRD/architecture.md` section 7;
  DEC-007 and DEC-012.
- **Approval:** written and self-reviewed by Kiro under Will's overnight
  authorisation of 24 November 2026. Human review is pending.

## Requirements

### Requirement 1: Validate and journal before writing (PRD-060)

1. WHEN a run of operations is proposed THEN the engine SHALL validate each
   one:
   - its path must be a note or `.nexus/issues.json`;
   - its target must exist;
   - its base revision must be current;
   - its `before` must match exactly once.
2. IF any operation is invalid THEN the engine SHALL return the reason for
   each and write nothing.
3. WHEN the operations are valid THEN the engine SHALL persist
   `.nexus/reviews/<runId>.json` before any workspace file is written. The
   journal records, for every file, its `beforeHash` and `afterHash`, and
   for every change its `opId`, `changeId`, target, `before`, `after`
   and context.
4. IF a proposal reuses an `opId` that already exists in a journal THEN the
   engine SHALL return the existing change and SHALL NOT apply it again.

### Requirement 2: Write real files and show them (PRD-061)

1. The engine SHALL write each affected file once, atomically. It SHALL
   mark the file `written` and its changes `pending` after each file.
2. Note and issue pages SHALL show a persistent "Pending review" marker on
   the exact paragraph, list item or field. The marker SHALL briefly
   highlight when the change is reached, using a static outline when the
   user prefers reduced motion.
3. A review bar SHALL let the user move between changes on different
   pages, and SHALL open each change's page.
4. A note editor that holds unsaved text SHALL keep it when a change lands.
   This uses the B1 "changed outside the editor" banner.

### Requirement 3: Accept and reject one change at a time (PRD-062)

1. WHEN the user accepts a pending change THEN its state SHALL become
   `accepted` with no file write.
2. WHEN the user rejects a pending change THEN the engine SHALL reverse only
   that change's region (a field, or a line-aligned span). Every other byte
   of the file SHALL be kept, including other changes and unrelated edits.
3. Before writing a reversal, the engine SHALL persist
   `reversal: { beforeHash, afterHash }` and the state `rejecting`.
4. IF the region no longer holds the proposed text, or the text occurs more
   than once and its neighbouring lines do not single out one occurrence,
   THEN the change SHALL become `conflicted` (`missing` or `ambiguous`) and
   no file SHALL be written. "Keep current" SHALL close it as rejected.
5. Accept, reject and keep-current SHALL be idempotent.

### Requirement 4: Feedback after rejection (PRD-064, partial)

1. WHEN a rejection takes effect THEN the UI SHALL ask what was wrong, or
   what should be kept. The user can answer or skip.
2. The answer SHALL be stored on the change. A correction run that creates
   a new reviewable change is slice D.

### Requirement 5: Recovery (PRD-065)

1. WHEN the service starts THEN, before serving writes, it SHALL resume
   every interrupted apply and rejection using only the saved hashes and
   changes (architecture section 7.5). It SHALL roll forward when a file
   still has its `beforeHash`, mark the change done when the file has its
   `afterHash`, and mark it `conflicted` otherwise.
2. Pending and conflicted changes SHALL appear in the review bar after a
   restart.

### Requirement 6: Pending dates never trigger reminders (PRD-066)

1. The reminder computation SHALL use effective accepted values. A
   `due` field that has a pending, conflicted, prepared or rejecting change
   SHALL be read as that change's `before`.

### Requirement 7: Fixed demo operations are labelled

1. Every run SHALL record `source.kind`. The demo run SHALL be labelled
   "Demo operations (fixed, not AI)" in the journal and in the UI.
