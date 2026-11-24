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
