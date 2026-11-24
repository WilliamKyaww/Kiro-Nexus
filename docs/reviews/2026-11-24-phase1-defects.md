# Review: Phase 1 defects on `2310608` (24 November 2026)

- **Scope:** the overnight build up to `2310608` (B1 workspace core, B5
  change journal, B2 search and outside edits).
- **Who did what:**
  - **Will** ran the app and reported the defects.
  - **Codex** independently reproduced the reported defects. Will reported
    this to Kiro; Kiro did not see Codex's output.
  - **Kiro** reproduced each defect again in a disposable fictional
    workspace, then implemented the fixes and tested them.
- **Correction:** `STATE.md`, `FEATURES.md` and the 24 November journal
  first said that Will had reproduced the defects himself. They were
  corrected on 24 November 2026 in the corrective pass.

## Findings and resolution

| Finding | Resolution | Commit |
| --- | --- | --- |
| A multi-file review run that failed part-way reported the wrong outcome, and a repeated demo said "already applied" | Each file's real outcome is reported, with Retry and Discard (architecture section 7.3) | `63cdc5b` |
| Note drafts were lost on navigation and when typing during an in-flight save; Compare did not show both texts | Drafts are kept in session storage, a save acknowledges only what it submitted, and Compare shows the disk text and the draft | `0b6c98e` |
| Issue edits from two tabs overwrote each other, and link changes cleared unsaved fields | Field-by-field merge with `baseValues` (DEC-015), and a separate request for link changes | `138f326` |
| At 390 px the review bar covered the selected change; Home had no working action with AI off; product screens showed internal planning words | The selected change is revealed above the bar, Home has note actions, and the wording was cleaned up | `943465b` |

The evidence for each fix is in `FEATURES.md` ("Phase 1 repairs") and the
specs' `tasks.md` files.
