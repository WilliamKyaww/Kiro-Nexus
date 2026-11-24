# State

- **Date updated:** 2026-11-24 (repair and Ask run finished; waiting for
  Will and Hein)
- **Active phase:** none. Phase 1 (the four repairs) and Phase 2 (slice C,
  read-only Ask) are complete and committed locally. Slice C's live check
  (task 5) is waiting for Will's free key.
- **Last spec:** `.kiro/specs/ask-readonly/`. Tasks 1 to 4 are done; task 5
  is partly done.
- **Baseline:** `2310608`, reviewed by Will. Will reproduced the Phase 1
  defects on it independently.
- **PRD:** approved by Will at `7b775cd`, with amendments 1 to 4 (DEC-011
  to DEC-014).

## Authorisation

- **Standing:** local milestone commits under DEC-004. Stage only the
  relevant files by name, review the staged diff, add no AI trailers, report
  the short hash, and never push.
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

Will reviewed the overnight work up to `2310608` and reproduced the Phase 1
defects on it.

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
test double. **No human has reviewed this run yet.**

## Unverified

- **Live AI (Q1).** No free provider was configured, and Kiro did not look
  for credentials. Nothing shows how a real model handles the tools,
  citations or the kickoff question. The Groq template is a candidate
  only.
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

1. **Will: run the live check** with a free Groq key (steps in
   `docs/judge-ai-route.md`):
   `npm run build`, then
   `$env:NEXUS_LIVE_KEY = "<your key>"; npm run live:check; Remove-Item Env:NEXUS_LIVE_KEY`.
   The result is written to `.tmp/live-check/`, with the key redacted.
   Close Q1 only if the answer cites the Actions heading and NEX-1.
2. **Will: decide Q5**, the judge route (PRD-091). The deadline in the PRD
   is 1 December.
3. **Register Playwright MCP in Kiro.** Kiro's policy blocks agent writes to
   `.kiro/settings/`. The exact steps and JSON are in `docs/tooling.md`.
   Then confirm that Kiro discovers the server, and run one tool call.
4. **Final rules recheck before submission** (`docs/submission-checklist.md`).
5. **Choose an open-source licence** (the README says "to be chosen").

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

- **Will:** try Ask with the README section "Try Ask" (`npm run double`,
  then `npm run demo:ask`). Then run `npm run live:check` with a free Groq
  key, and record the result in `docs/judge-ai-route.md` and here.
- **Hein:** write and run the B3 board and calendar spec against
  `docs/data-format.md` and the review states in
  `packages/schema/src/review.ts`.

### Continuation instruction for a fresh Kiro session

> Read `AGENTS.md`, this file, `BACKLOG.md` and `FEATURES.md`. The repair
> and Ask authorisation is spent, so do not start a new slice until Will or
> Hein names one. To check that everything still works, run
> `npm run typecheck`, `npm test`, `npm run test:e2e` and
> `npm run scan:secrets`. The expected totals are 100 and 26 passing. If
> Will supplies a live-check result, record it in slice C task 5 and in
> `docs/judge-ai-route.md`, and close Q1 only if a real free call
> succeeded. When a slice is authorised:
>
> 1. Write its native spec under `.kiro/specs/<slice>/`.
> 2. Follow the working loop in `AGENTS.md`.
> 3. Commit each verified milestone locally under DEC-004, and never push.
