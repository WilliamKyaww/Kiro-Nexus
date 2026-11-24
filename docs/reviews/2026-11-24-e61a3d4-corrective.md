# Review: defects on `e61a3d4` and the corrective pass (24 November 2026)

- **Scope:** slice C read-only Ask, the live-check command and issue
  editing, as committed up to `e61a3d4`.
- **Who did what:**
  - **Will** authorised the corrective pass and reported six defects
    against the independently reviewed baseline `e61a3d4`. He observed the
    issue-save defect himself. His request does not name the reviewer of
    `e61a3d4`, so this record does not attribute the review to anyone.
    Will can add the name here.
  - **Kiro** reproduced each defect, added regression tests, fixed it and
    committed each fix separately.
- **Evidence:** every check below ran against the deterministic test
  double, which is a fixture and not AI. No live provider was called.

## Findings and resolution

| # | Finding | Reproduced by Kiro as | Resolution | Commit |
| --- | --- | --- | --- | --- |
| 1 | The live check's provider test returned 400 before reaching the provider, yet the command exited 0 | CLI against the double: `"The request could not be read."`, exit 0 | Correct request, every response checked, bounded waits, the service stopped on every path, a distinct exit status for each failure, and a fixture never counts as a live pass | `9c77f9c` |
| 2 | Non-fatal probe errors were saved in profile details before redaction; the runbook put a literal key in a PowerShell command | A double that echoes the key: the key was in `providers.json`, `GET /providers` and the CLI output | One shared sanitiser for UI, logs, files and the CLI report; a masked key prompt | `0652062` |
| 3 | With 51 issues, Ask read 50 and recorded "has no matching issue" as a fact; search snippets and section reads disagreed about pending note text | Both modes recorded the absence as a fact; the snippet showed `[x]` and the section `[ ]` | Paged and targeted issue queries, coverage tracking, a "Not confirmed" section, and accepted-text snippets | `93310e4` |
| 4 | Two simultaneous sends to one conversation both got 202, and only one question was stored | `[202, 202]`; with the final save delayed, a second send was admitted before the answer was saved | The slot is claimed before the first await and held until the answer is saved; other sends get 409 busy | `9aa6eba` |
| 5 | A title typed during an in-flight issue save was replaced by the older value while the form said "Saved" | With the save delayed by 1.2 s: "Saved · revision 2" and the newer title gone | A save acknowledges only the submitted values | `07d38ec` |
| 6 | A follow-up question had no conversation context | "Which of those is already tracked?" gave insufficient evidence in both modes | Bounded context from the same conversation; evidence and citations re-checked each run | `1c4cd75` |

The tests for each fix are listed in `.kiro/specs/ask-readonly/tasks.md`
(task 6) and `.kiro/specs/workspace-core/tasks.md` (task 12).
