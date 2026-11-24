# State

- **Date updated:** 2026-11-24 (Ask repairs, B3 and first Edit journey in
  progress)
- **Active phase:** the current run below: Ask repairs (milestones 1 to 3),
  then the B3 board and calendar slice, then the first Edit journey. Slice
  C's live check (task 5) is waiting for Will's free key.
- **Last spec:** `.kiro/specs/ask-readonly/`. Tasks 1 to 4 and 6 are done;
  task 5 (the live check) is partly done.
- **Baselines:**
  - `2310608` for Phase 1: Will ran the app and reported the defects,
    Codex independently reproduced them, and Kiro implemented and tested
    the fixes (`docs/reviews/2026-11-24-phase1-defects.md`).
  - `e61a3d4` for the corrective pass: independently reviewed, with six
    defects reported by Will
    (`docs/reviews/2026-11-24-e61a3d4-corrective.md`).
- **PRD:** approved by Will at `7b775cd`, with amendments 1 to 4 (DEC-011
  to DEC-014).

## Authorisation

- **Standing:** local milestone commits under DEC-004. Stage only the
  relevant files by name, review the staged diff, add no AI trailers, report
  the short hash, and never push.
- **Current run: Ask repairs, B3 board and calendar, first Edit journey
  (granted by Will on 2026-11-24; it survives context compaction).**
  - **Scope:**
    1. Ask reliably matches meeting actions to issues. It recovers from an
       empty narrow search by checking the project's records and comparing
       the actual actions. A shared heading is not evidence of which action
       an issue tracks. A claim about an action's tracking is a recorded
       fact only if the run's evidence supports it, which does not depend
       on a list of English phrases.
    2. The live CLI proves the two-turn journey (missing action, then NEX-2
       created through the issue API and recognised in the same
       conversation), checks that Ask leaves notes and issues unchanged,
       and fixes two evaluator bugs. Fixture exit 6 stays. Q1 closes only
       after a real free-provider pass, and Q5 stays open.
    3. Search, section reads and citation navigation agree during a pending
       heading rename, and after its acceptance or rejection.
    4. A first working B3 slice: a three-column board with the backlog kept,
       creating and opening issues, drag and keyboard status changes,
       priority and due dates, and a month view of dated issues. A due-date
       edit from either view updates the same issue and survives a restart.
       It must work with AI off, by keyboard and at narrow width. Calendar
       events, the agenda view and the final visual design stay with Hein,
       and B3 stays partially complete.
    5. The first Ask → Edit → Review journey (one J7 slice). It uses typed
       operations and the existing journal, per-change decisions,
       dependencies, preserved manual edits and restart recovery. Ask stays
       read-only.
  - **Allowed:** self-review of native specs and routine decisions without
    waiting; a local commit after each verified repair or increment.
  - **Boundaries:**
    - isolated fictional workspaces;
    - leave Will's demos (`.tmp/try`, `.tmp/ask-demo`) alone;
    - no credential search and no paid services;
    - no remote publication.
  - **Found at the start:** `vitest.config.ts` was deleted in the working
    tree, with no replacement. Kiro did not restore it or commit the
    deletion. Tests in this run use a temporary copy,
    `.tmp/vitest.config.ts`.
- **Corrective pass on `e61a3d4` (granted by Will on 2026-11-24): used
  up.** Items 1 to 6 are delivered (the milestone log below). Its
  boundaries matched the repair and Ask run below. Agent edits, reminders,
  deployment and pushing still need separate authorisation.
- **Repair and Ask run (granted by Will on 2026-11-24): used up.** Both
  phases are delivered. Its scope, kept for the record:
  - **Phase 1.** Reproduce, add regression coverage for, fix, verify and
    commit each of the following:
    1. partial review runs, with Retry and Discard (architecture section
       7.3);
    2. note drafts lost on navigation or during an in-flight save, and
       Compare showing both texts;
    3. issue edits overwriting each other, including during link add and
       remove;
    4. the review bar covering a 390 px screen, a working action on Home
       when AI is off, and internal wording on product screens.
  - **Phase 2.** Slice C, read-only Ask:
    1. Write the native spec, self-review it and commit it.
    2. Build provider settings (one OpenAI-compatible adapter and one
       candidate free route), the read-only coordinator, and the Home and
       conversation UI.
    3. Prove the workflow end to end with a deterministic provider double
       and two fictional workspaces.
    4. Run a live check only if an explicitly configured free profile
       exists.
  - **Allowed:**
    - self-review of native specs and routine decisions without waiting;
    - incremental local commits after each verified repair or increment.
  - **Boundaries:**
    - Hein owns B3 and the final visual identity. Keep his slice buildable
      on its own.
    - Leave Will's `.tmp/try` workspace alone, and use isolated profiles
      and synthetic data.
    - Do not search for credentials, and use no paid services.
    - Agent writes, reminder delivery and remote publication are outside
      this run.
- **Previous overnight authorisation:** used up.
- **Not authorised now:** any new slice, including D (agent edits) and B4
  (reminders), until Will or Hein names one.
- **Never authorised without an explicit request:**
  - remote Git actions, publication, deployments, account changes and paid
    services;
  - system-wide installs;
  - provider credentials.

## Milestone log (overnight)

| Milestone | Status | Commit | Evidence |
| --- | --- | --- | --- |
| A. PRD amendments, B1 spec, W4 tools, wireframe | Done | `9b5b23a` | Kiro self-reviewed the B1 spec. Impeccable detect returned `[]` after one fix, and its renders were checked. The Playwright MCP stdio smoke test passed 6 of 6 |
| B. B1 workspace core | Done | `beb2b68` | Tests passed (38 unit and integration, 4 E2E). Manual runs of `try`, `open`, `stop` and `desktop` behaved as documented |
| C. B5 change journal and review UI | Done | `556b1ca` | Tests passed (64 unit and integration, 6 E2E). Real crash recovery, property tests and a mutation check passed. The Kiro hooks fire and record PASS or FAIL |
| D. B2 search and outside edits | Done | `2310608` | 71 unit and integration tests, stable across 3 runs. 8 E2E tests, 24 of 24 across 3 repeats |

Will ran the overnight build up to `2310608` and reported the Phase 1
defects. Codex independently reproduced them, and Kiro implemented and
tested the fixes.

## Milestone log (repair and Ask run)

| Increment | Commit | Evidence |
| --- | --- | --- |
| 1. Partial review runs: honest outcomes, Retry and Discard | `63cdc5b` | Reproduced first. `partial.test.ts`, a real-process failed write then Retry, and the E2E test in `b5-review.spec.ts` |
| 2. Note drafts across navigation and in-flight saves | `0b6c98e` | Reproduced first. `drafts.test.ts` and `b2-drafts.spec.ts` (4 tests, one with a deliberately delayed save) |
| 3. Issue edits merged field by field (DEC-015) | `138f326` | Reproduced first. `workspace.test.ts` and `b1-issue-edits.spec.ts` (3 tests) |
| 4. Narrow review bar, Home action with AI off, product wording | `943465b` | Measured first. `usability.spec.ts` (5 tests) and Impeccable detect `[]` |
| Phase 1 documentation | `0a3e674` | n/a |
| Slice C spec, self-reviewed | `b8c3819` | n/a |
| C1. Provider settings and protected keys | `00084bc` | `providers.test.ts` and `c1-providers.spec.ts` (browser and Electron safeStorage) |
| C2. Read-only coordinator (DEC-017) | `f065fa2` | `ask.test.ts` (11 tests) |
| C3. Home, conversations and citations | `e6b3aa6` | `ask-http.test.ts` and `c3-conversations.spec.ts` |
| C4. End-to-end proof in two fictional workspaces | `a5195b5` | `c4-ask-proof.spec.ts` (2 tests) |
| Plain status words in the test double's answers | `77f2d4b` | Found on a 390 px screenshot. `ask.test.ts` |
| One-command Ask demo and README walkthrough | `65f951a` | `npm run demo:ask` started twice: the first run copied the sample, the second reused it |

**Final checks (Kiro, at `65f951a`):**

- `npm run typecheck` reported no errors.
- `npm test` passed 100 of 100.
- `npm run test:e2e` passed 26 of 26.
- `npm run scan:secrets` passed (242 files).

Earlier in the run, an E2E sweep with `--repeat-each=2` passed 52 of 52.
One previous sweep had a single failure of the b5 test "a failed issue
write is reported honestly…" with no saved error context. The test then
passed 8 of 8 on its own and in the next full sweep. The cause is unknown,
so treat it as a possible flake.

Every check in this run was done by Kiro, and every answer came from the
test double. `e61a3d4` was then independently reviewed, which led to the
corrective pass below.

## Milestone log (corrective pass on `e61a3d4`)

Each defect was reproduced by Kiro before it was fixed. The details are in
`docs/reviews/2026-11-24-e61a3d4-corrective.md` and slice C task 6.

| Item | Commit | Evidence |
| --- | --- | --- |
| 1. The live check reaches the provider and fails honestly | `9c77f9c` | `live-check-cli.test.ts`: the real CLI against the double gives exit 6 (fixture) with 7 of 7 checks passing; each failure class has its own status; the service process has gone afterwards |
| 2. Provider diagnostics sanitised; masked key prompt | `0652062` | `sanitise.test.ts`: a sentinel key and a 16-character fragment are absent from the API, `providers.json`, `service.log`, the conversation, stderr and the CLI report and output |
| 3. Absence claims need full issue coverage; accepted-text snippets | `93310e4` | `coverage.test.ts` (both modes, 51 issues) and the "Not confirmed" browser test |
| 4. One question at a time per conversation, until saved | `9aa6eba` | `ask-http.test.ts`: two simultaneous sends, a burst of six, a delayed final save, and the files checked after a restart |
| 5. Issue fields typed during a save stay unsaved and visible | `07d38ec` | `acknowledge.test.ts` and `b1-issue-edits.spec.ts` (delayed save); the field-merge and link tests still pass |
| 6. Follow-ups use the same conversation | `1c4cd75` | `ask-http.test.ts` (both modes), `context.test.ts` and the follow-up browser test |

**Checks (Kiro, at `1c4cd75`; the documentation commit after it changes no
code):**

- `npm run typecheck` reported no errors.
- `npm test` passed 139 of 139.
- `npm run test:e2e` passed 29 of 29, and 58 of 58 with `--repeat-each=2`.
- `npm run scan:secrets` passed.
- `ask-http.test.ts` ran 33 times: 32 passed, and one run failed after
  51 s with no output captured. The failure has not recurred, and the
  cause is unknown.

**No human has reviewed the corrective pass yet.**

## Unverified

- **Live AI (Q1).** No free provider was configured, and Kiro did not look
  for credentials. Nothing shows how a real model handles the tools,
  paging, citations, follow-up context or the kickoff question. The Groq
  template is a candidate only.
- **Masked key prompt in a real console.** It was tested with a simulated
  terminal; Will's PowerShell window has not been tried.
- **Absence wording.** "Not confirmed" relies on a wording heuristic for
  claims that no issue tracks something. A real model may phrase an
  absence claim in a way the heuristic misses, which would leave it under
  "Recorded facts" when coverage is incomplete.
- **Team route (Q5, PRD-091).** Proposed in `docs/judge-ai-route.md`, but
  neither decided nor built.
- **Packaged build.** There is no Windows zip yet (slice E). The Electron
  tests run against the local build.
- **Playwright MCP inside Kiro.** It has been tested over stdio only; a
  human still has to register it.
- **Review hooks for one Phase 2 edit.** The hooks did not run for the
  `server/src/workspace/service.ts` change in `e6b3aa6`, possibly because
  it was made with a shell command (not confirmed). They fired and passed
  when retested at 11:47 (see the journal), and the full suite covers that
  change.

## Human actions pending

1. **Will: run the live check** with a free Groq key (steps and exit
   statuses in `docs/judge-ai-route.md`). In a PowerShell window in the
   repository, run `npm run build`, then `npm run live:check`, and paste
   the key at the masked prompt. Check the exit status with
   `$LASTEXITCODE`. The result is written to `.tmp/live-check/`,
   sanitised. Close Q1 only on exit 0 (a live pass).
2. **Will: add the reviewer's name** to
   `docs/reviews/2026-11-24-e61a3d4-corrective.md`. The review of
   `e61a3d4` is recorded without attribution.
3. **Will: decide Q5**, the judge route (PRD-091). The deadline in the PRD
   is 1 December.
4. **Register Playwright MCP in Kiro.** Kiro's policy blocks agent writes to
   `.kiro/settings/`. The exact steps and JSON are in `docs/tooling.md`.
   Then confirm that Kiro discovers the server, and run one tool call.
5. **Final rules recheck before submission** (`docs/submission-checklist.md`).
6. **Choose an open-source licence** (the README says "to be chosen").

## Assumptions to check

| # | Assumption (Kiro's) | For |
| --- | --- | --- |
| 1 | A single root package with path aliases replaces npm workspaces (techstack section 1) | Will |
| 2 | B1 and B2 use a `<textarea>` editor, with CodeMirror still in the B2 backlog | Will, Hein |
| 3 | The web UI takes a typed folder path, because browsers have no native picker. Electron has **Browse…** | Hein |
| 4 | The palette and layout of the wireframe and app are placeholders. Hein owns the final identity | Hein |
| 5 | Impeccable telemetry is left on globally and disabled per call. Decide whether to run `npx impeccable telemetry off` | Will |
| 6 | The E2E tests use the system Microsoft Edge (`channel: msedge`), with no Playwright browser download | Hein |
| 7 | TypeScript 7.0.2 is used only for type checking. esbuild and Vite transpile | Will |
| 8 | The browser and desktop routes share the `npm run try` workspace, so running both shows the lock message, which is intended | Will |
| 9 | For a field with an unsettled change, reminders use its `before` value only while the field still holds the proposed value. A newer manual edit stands (B5 design) | Will |
| 10 | Agent edits fire both review hooks (tool and save), so the 3-second test run happens twice | Will |
| 11 | "Overwrite with mine" after an outside edit replaces the outside text without merging. The user chooses it after comparing | Will, Hein |
| 12 | Drafts live in the tab's session storage, so they survive navigation and a reload but not closing the tab | Will, Hein |
| 13 | When a search for every word finds nothing, search falls back to any word, because questions rarely match every word | Will |
| 14 | The composer's submit button is called **Send**, so it does not clash with the Ask/Edit switch. Edit is shown but disabled until slice D | Hein |
| 15 | In the browser, provider keys are held in service memory for the session only, so a browser user re-enters the key after a restart | Will |
| 16 | Follow-up context is the last 3 answered turns, capped at 4,000 characters, sent as plain text with citation labels and no handles | Will |
| 17 | Retrieval-first mode reads at most 200 issues. Tool mode pages 50 at a time within its 8-step limit, so about 250 at most unless the model makes a targeted lookup. Beyond that, absence claims show as "Not confirmed" | Will |
| 18 | A send to a busy conversation is refused (409) rather than queued; the composer keeps the typed question for a later send | Will, Hein |
| 19 | "Not confirmed (Nexus did not read every record)" is a separate answer section. Its styling is a placeholder for Hein | Hein |

## Blockers and risks

- **Blocker:** none for the existing work.
- **Blocked:** the live check (slice C, task 5) needs Will's free key.
- **Risk:** the free model route is unverified (Q1). A real model may call
  the tools or cite sources less reliably than the test double does.
- **Risk:** the team evaluation route is still open (Q5, PRD-091).
- **Dates:** Kiro credit requests close on 1 December at 20:00 GMT. The
  feature freeze is on 2 December. Submission closes on 4 December at
  22:00 GMT.

## Next action

- **Will:** run `npm run live:check` with a free Groq key and record the
  exit status and report in `docs/judge-ai-route.md` and here. Close Q1
  only on exit 0.
- **Hein:** write and run the B3 board and calendar spec against
  `docs/data-format.md` and the review states in
  `packages/schema/src/review.ts`.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md`, this file, `BACKLOG.md` and `FEATURES.md`. The
> corrective-pass authorisation is spent, so do not start a new slice
> until Will or Hein names one. To check that everything still works, run
> `npm run typecheck`, `npm test`, `npm run test:e2e` and
> `npm run scan:secrets`. The expected totals are 139 and 29 passing. If
> Will supplies a live-check result, record it in slice C task 5 and in
> `docs/judge-ai-route.md`, and close Q1 only on exit 0 from a real free
> provider. When a slice is authorised:
>
> 1. Write its native spec under `.kiro/specs/<slice>/`.
> 2. Follow the working loop in `AGENTS.md`.
> 3. Commit each verified milestone locally under DEC-004, and never push.
