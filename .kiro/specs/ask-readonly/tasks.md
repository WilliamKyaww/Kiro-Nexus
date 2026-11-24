# Implementation plan: C, read-only Ask

This is the only checklist for slice C. Tick a task only after its
acceptance condition has been seen to pass.

- [x] 1. Provider profiles, keys, adapter and probes (increment C1)
  - **Verified by Kiro, 2026-11-24:**
    - `providers.test.ts` (4 tests, including the real service and a disk
      scan for the fake key);
    - `tests/e2e/c1-providers.spec.ts` (browser and Electron, with
      safeStorage, relaunch and remove);
    - `npm run scan:secrets` passed.
  - **Acceptance:**
    1. Unit and integration tests against the test double show that:
       - tool calling and structured output are probed separately and
         stored;
       - 401, 429 (with retry), timeout and cancellation each give a
         distinct message;
       - non-HTTPS remote base URLs are refused.
    2. `GET /providers` never returns a key.
    3. A scan for a fake key in the profile, workspace and logs finds
       nothing.
    4. In the Settings UI, a user can add, test, select and remove a
       profile.
    5. An Electron test shows that a key saved through the preload is
       encrypted in `secrets.bin`, survives a relaunch, and never reaches
       renderer storage.
  - _Requirements: 1, 2, 3_

- [x] 2. Read-only coordinator, tools, handles and validation (increment C2)
  - **Verified by Kiro, 2026-11-24:** `server/src/ask/ask.test.ts` (11
    tests, using the double). It covers:
    - the kickoff answer, and the answer after the missing issue is
      created;
    - retrieval-first mode;
    - invented citations removed and demoted;
    - `propose_changes` rejected despite an injected instruction;
    - insufficient evidence, and a plain reply that is not shown as fact;
    - pending values reported as proposed, and a renamed heading;
    - a second workspace with different names;
    - workspace hashes unchanged.
  - **Acceptance:** coordinator tests with the double show that:
    1. Answers cite valid handles. Invented handles are removed and
       counted, and unsupported facts are demoted.
    2. `propose_changes` is rejected.
    3. A heading that is missing or renamed is reported as "heading not
       found".
    4. A pending due date is reported as proposed, with the accepted value
       given as the fact.
    5. Retrieval-first mode works for structured-output-only profiles.
    6. An insufficient-evidence question is flagged.
    7. Every workspace file except the conversations is byte-for-byte
       unchanged.
  - _Requirements: 2.2, 2.3, 4, 5_

- [x] 3. Conversations, Home and citations (increment C3)
  - **Verified by Kiro, 2026-11-24:**
    - `server/src/ask/ask-http.test.ts` (2 tests, against the real
      service): availability states; only the conversation changes; the
      model is pinned; cancel; a rejected key; one run at a time; a crash
      mid-run is marked interrupted.
    - `tests/e2e/c3-conversations.spec.ts`: cancel; Retry with the
      structured-only fallback; a rejected key pointing to Settings.
    - The C4 journey also covers citations, "Back to conversation" and
      persistence across a restart.
  - **Acceptance:** E2E tests show that:
    1. Home shows the workspace and model.
    2. An answer renders facts, discrepancies, suggestions and the
       fixture label.
    3. A citation opens the exact heading or issue, and "Back to
       conversation" returns to it.
    4. Cancel and failure with Retry work.
    5. Home with AI off still offers notes.
    6. Conversations persist across a restart.
  - _Requirements: 5.4, 6_

- [x] 4. End-to-end proof in two fictional workspaces (increment C4)
  - **Verified by Kiro, 2026-11-24, using the double (a fixture, not AI):**
    - `tests/e2e/c4-ask-proof.spec.ts` (2 tests):
      - the kickoff answer;
      - the Actions and NEX-1 citations, each opened and returned from;
      - NEX-2 created by hand, then recognised;
      - workspace hashes unchanged except `.nexus/conversations/`;
      - persistence across a restart;
      - the second "planning" workspace with OPS keys.
    - `ask.test.ts` repeats the second-workspace check at the service
      level.
  - **Acceptance:** a Playwright journey on the kickoff sample:
    1. Ask the question, and the answer names the judge-instructions action
       as untracked and NEX-1 as tracking the calendar work.
    2. Open the Actions heading and NEX-1.
    3. Create the missing issue, ask again, and the answer says it is
       tracked.

    A second synthetic workspace, with different people, actions and keys,
    gives matching answers. Workspace hashes before and after show that
    only `.nexus/conversations/` changed.
  - _Requirements: 4.2, 7.1–7.3_

- [~] 5. Live check, Q1 and Q5 documentation
  - **Done:**
    - `docs/judge-ai-route.md` sets out the proposed team relay (Option A,
      not built), the judge's own key and a local model, each marked as
      tested or not.
    - `npm run live:check` was written and checked to refuse to run
      without a key.
  - **Not done:** the live check. No free provider profile or credential
    was configured for this project, and Kiro did not search for one. Q1
    stays open. The exact steps for Will are in `docs/judge-ai-route.md`.
  - **Acceptance:**
    - A live check against a real free route runs only if a configured
      free profile exists. Otherwise the exact steps for Will are recorded,
      and Q1 stays open.
    - `docs/judge-ai-route.md` describes the proposed team route and marks
      it as not tested.
  - _Requirements: 7.4; PRD-091_

- [~] 6. Corrective pass on the reviewed baseline `e61a3d4` (authorised by Will, 2026-11-24)
  - [x] 6.1 The live-check command reaches the provider and fails honestly
    - **Defect, reproduced by Kiro on `e61a3d4`:** run against the local
      double, the CLI printed `Capabilities: {"error":"The request could
      not be read."}` and "No answer", and exited 0. The bodyless
      `POST /providers/:id/test` declared `application/json`, so Fastify
      returned 400 before any route ran.
    - **Fix:** JSON is declared only when a body is sent. Every response
      is checked against its expected status. Start-up (20 s), each request
      (15 s, probes 150 s) and the answer wait (240 s, configurable) are
      bounded. The service is stopped on every path, and a process
      `exit` or signal handler kills it as a last resort. Exit status:
      0 live pass, 1 an answer check failed, 2 set-up, 3 key rejected,
      4 timeout, 5 no usable capability, 6 fixture (never a live pass),
      7 other provider error. Both probes failing for the same transport
      reason is now a failed test, not "capabilities: error".
    - **Report checks:** the answer completed; the evidence was sufficient;
      a recorded fact names the judge-instructions action as missing and
      cites the Actions heading; a fact or discrepancy cites NEX-1 for the
      calendar work; both citation targets exist.
    - **Verified by Kiro:** `live-check-cli.test.ts` runs the real CLI
      against the double. The working transport gives exit 6 with all 7
      checks passing, and the service process is gone afterwards. A
      rejected key, a model with neither capability, a slow answer, an
      insufficient-evidence answer, an answer without the NEX-1 citation
      and a missing key each give their own status. Q1 stays open.
  - [x] 6.2 Provider diagnostics are sanitised, and the key is entered at a masked prompt
    - **Defect, reproduced by Kiro on `e61a3d4`:** a provider that echoed
      the bearer key in a non-fatal probe error (double variant `-echo`)
      had it copied into the profile's `detail`. The key was saved in
      `providers.json`, returned by `GET /providers` and printed by the
      live check. The runbook told Will to type the key into a PowerShell
      command, which puts it in the shell history.
    - **Fix:** one shared sanitiser (`server/src/providers/sanitise.mjs`)
      removes known keys, any run of 8 or more characters copied from one,
      key-shaped strings, bearer tokens and key query parameters. It also
      strips control and bidirectional characters, and caps the length.
      It is applied at the source (the adapter's provider message), to probe
      details before they are saved and again on output, to provider errors
      in conversations, to every service log line, and to the live-check
      console output and report. The live check now asks for the key at a
      masked prompt. A key from the environment is removed at once and is
      never passed to the service process.
    - **Verified by Kiro:** `sanitise.test.ts` uses a synthetic sentinel
      key. The HTTP responses, `providers.json`, `service.log`, the
      conversation file, stderr, the CLI report and the CLI output contain
      neither the sentinel nor a 16-character fragment of it. The prompt
      echoes only `*`, handles backspace, paste markers and Ctrl+C, and
      restores the terminal. These prompt tests use a simulated terminal;
      a real console was not driven.
  - [x] 6.3 Absence claims need full issue coverage, and snippets show accepted text
    - **Defect, reproduced by Kiro on `e61a3d4`:** with 51 issues and "Write
      the judge instructions" at NEX-51, both modes read 50 and recorded
      "has no matching issue" as a fact. The search snippet for the kickoff
      Actions showed the proposed `- [x]`, while the section read showed the
      accepted `- [ ]`.
    - **Fix:** `query_issues` pages (`offset`, `nextOffset`), its `text`
      filter also matches every word, and a truncated page tells the model
      how to read the rest. The run tracks which issue records it has seen.
      Without full coverage, absence claims move to "Not confirmed" with a
      qualifier, and the scope note says how many were read.
      Retrieval-first mode reads up to 200 issues page by page. Search
      snippets for notes with pending edits are rebuilt from the accepted
      text and carry `pendingReview`. Requirements 5.7 and 5.8 were added.
    - **Verified by Kiro (test double, both modes):** `coverage.test.ts`
      (10 tests) covers a match at NEX-51 and a genuinely missing task
      (stated as a fact only after 51 of 51 records were read). It also
      covers a claim that stays qualified when coverage is incomplete
      (`-lazy`, or a 50-issue retrieval cap), a pending checklist tick
      reported as proposed in the data sent to the model, and snippet and
      section agreement. `c4-ask-proof.spec.ts` shows the "Not confirmed"
      section and its qualifier in the browser.
  - [x] 6.4 One question at a time per conversation, held until the answer is saved
    - **Defect, reproduced by Kiro on `e61a3d4`:** two clients sending to
      one conversation at once both got 202 (`[202, 202]`), and only one
      question was stored. With the window between the run finishing and
      its answer being written widened (`NEXUS_FAULT_DELAY`), a second send
      was admitted (202) before the first answer was saved.
    - **Fix:** the route takes the conversation's slot with no `await`
      between the check and the claim. The slot is released only after the
      answer has been written, or at once if nothing started. Every
      transcript change goes through `ConversationStore.update`, which runs
      read-modify-write one at a time per conversation. A refused send gets
      409 `CONFLICT` with `details.reason: "busy"` and the message "This
      conversation is already answering a question. Wait for the answer, or
      cancel it, then send again." The composer keeps the typed question
      and refreshes the conversation.
    - **Verified by Kiro:** `ask-http.test.ts` sends from two sessions at
      once (one 202, one 409), then a burst of six (one 202, five 409).
      After a restart, each conversation file holds exactly the admitted
      question and its answer, with matching run IDs. A send during the
      delayed save gets 409, and the next send after the save is admitted.
      There were 33 repeat runs of the file. One run failed after 51 s; its
      output was not captured, and it did not recur in the other 32.
  - [x] 6.5 Issue edits made during Save: tracked as workspace-core task 12
  - [x] 6.6 Follow-ups use the same conversation
    - **Defect, reproduced by Kiro on `e61a3d4`:** every run received only
      its own question. "Which of those is already tracked?" after the
      kickoff question returned insufficient evidence in both modes.
    - **Fix:** the bounded context described in the design, in both modes.
      In retrieval-first mode the earlier questions are searched as well.
      Citations are still validated per run, and `meta.contextTurns` is
      stored. The conversation page now says that Ask reads the last few
      questions and checks the workspace again for every answer.
    - **Verified by Kiro (test double):**
      - `ask-http.test.ts` covers both modes against the real service. The
        follow-up names only the tracked action (NEX-1) and cites the
        Actions heading and NEX-1, retrieved in that run. The context
        block sent to the model carries labels and no handles. After NEX-2
        is created by hand, the next follow-up reports both actions as
        tracked and cites NEX-2.
      - `context.test.ts` covers the bounds.
      - `c4-ask-proof.spec.ts` covers the follow-up in the browser,
        including opening a citation and returning.

- [x] 7. Match meeting actions to issues by evidence (requirement 8; run 4)
  - **Reproduced by Kiro on `4093fa1`'s server code** (with a throwaway
    test, since deleted):
    - `query_issues({ text: "Hein calendar view" })` returned 0 issues;
    - a model that never queried issues (`-noissues`) had "The judge
      instructions do not appear on the board." recorded as a fact. The
      scope note said "issue records were not consulted".
  - **Fix:** structured `tracking` entries, checked against the run's
    evidence, with Nexus composing the sentences. Also:
    - an empty text lookup falls back to the project's records;
    - sections list their actions, and heading links carry a caveat;
    - tool mode reads the remaining records before accepting an answer
      about issues;
    - a structural rule for free-text facts about sections of actions;
    - the `ABSENCE` phrase list is removed;
    - the answer card's section is now titled "Not confirmed by the
      evidence".
  - **Verified by Kiro (test double):**
    - `matching.test.ts` (7 tests):
      - the fallback lookup;
      - `-narrow` answers correctly after looking up "Hein builds the
        calendar view";
      - `-heading`'s claim that NEX-1 tracks the judge action is not
        confirmed;
      - `-noissues` gets the record from Nexus and answers correctly, or,
        with the cap at 0, its claim is not confirmed;
      - the validator's rules, including an absence claim worded so that
        no phrase list would catch it.
    - `coverage.test.ts`, `ask.test.ts`, `ask-http.test.ts` and
      `c4-ask-proof.spec.ts` pass with the new contract.
  - **Not verified:** a live model.
- [x] 8. The live check proves the two-turn journey (requirement 9; run 4)
  - **Defects (reproduced by Codex on the old evaluator):**
    - "NEX-1 does not track the calendar work" scored 7/7 next to a
      correct missing-action sentence;
    - a correct answer failed because its first NEX-1 citation described
      the status.
  - **Fix:** `evaluateTurn` reads the structured tracking entries, which
    Nexus has already checked against the run's evidence. It also fails if
    a confirmed entry contradicts the expected one. The CLI runs:
    1. turn 1;
    2. NEX-2 created with `POST /issues`;
    3. turn 2 in the same conversation.

    It hashes the notes and the issue and project data around each Ask.
    The browser journey in `c4-ask-proof.spec.ts` applies the same
    `evaluateTurn` to the stored conversation.
  - **Verified by Kiro:** `live-check-cli.test.ts` (14 tests). Against the
    double, the real CLI passes all 17 checks over two turns, with no
    files changed by Ask and exit 6. `-narrow` passes the journey;
    `-heading`, `-unsure` and `-nocite` fail turn 1 with exit 1; the other
    exit statuses are unchanged. Both evaluator bugs have regression tests.
  - **Not done:** a live run. Q1 stays open until Will's free-provider run
    exits 0.
