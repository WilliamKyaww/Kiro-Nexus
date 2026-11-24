# Requirements: C, grounded read-only Ask across notes and issues

## Introduction

Slice C lets a user ask a question about their notes and issues and get an
answer that cites the exact note heading or issue it relies on. The answer
keeps recorded facts, discrepancies and suggestions apart. Ask is read-only.
Edits by the agent are slice D, and the Edit mode stays unavailable.

- **Traces to:**
  - PRD-010 (Home), PRD-050 to PRD-055 (coordinator, authority, citations,
    insufficient evidence, retrieval, injection);
  - PRD-074 to PRD-076 (provider profiles, capabilities, keys);
  - PRD-091 (team evaluation route; designed here, not built);
  - `docs/PRD/architecture.md` sections 4.3 and 9, and DEC-008 and DEC-014.
- **Approval:** written and self-reviewed by Kiro under Will's authorisation
  for this run (2026-11-24). Human review is pending.

## Glossary

- **Profile:** a named OpenAI-compatible endpoint: its base URL, a model,
  and its tested capabilities. A profile never contains a key.
- **Handle:** a citation label (`S1`, `S2` and so on) assigned to each
  source retrieved during one run.
- **Test double:** a deterministic, local OpenAI-compatible server used in
  tests. It is not AI, and its output is always labelled as a fixture.

## Requirements

### Requirement 1: Provider profiles (PRD-074)

1. The user SHALL be able to add a profile (name, base URL, model, key),
   test it, select it and remove it in Settings.
2. The base URL SHALL be `https://`, or `http://` on `127.0.0.1` or
   `localhost`, so that a local model such as Ollama or the test double can
   be used. Anything else SHALL be refused.
3. Settings SHALL name the host that will receive retrieved excerpts before
   any question is sent, and SHALL warn that free tiers may use prompts for
   training.
4. A template SHALL prefill the candidate free route: Groq's free plan,
   `https://api.groq.com/openai/v1`, `openai/gpt-oss-20b`. It is labelled
   "not yet verified" until a real call succeeds (Q1).

### Requirement 2: Capabilities and failures (PRD-075)

1. **Test** SHALL probe tool calling and structured output separately, and
   store each result (yes, no or error) with the time.
2. The model SHALL be pinned when a run starts and recorded in the run.
3. Invalid credentials (401 or 403), rate limits (429, honouring
   `Retry-After`), timeouts, cancellation and network failures SHALL each
   produce a distinct, plain message. Rate limits and timeouts SHALL be
   retried at most twice. A run SHALL take at most 8 model steps.

### Requirement 3: Keys (PRD-076)

1. **Desktop:** keys SHALL be encrypted with Electron `safeStorage`
   (DPAPI on Windows), stored in the profile folder, and passed to the
   service over the private process channel. If OS encryption is
   unavailable, the key SHALL be kept for the session only, and the user
   told.
2. **Browser:** keys SHALL be held only in service memory for the session.
3. A key SHALL NOT appear in any of the following:
   - renderer storage;
   - workspace files;
   - `providers.json`;
   - logs;
   - HTTP responses;
   - conversation files;
   - Git;
   - test artefacts;
   - build output.
4. Notes and Projects SHALL work with no profile, no key and no network.

### Requirement 4: Read-only coordinator (PRD-050, PRD-051, PRD-054)

1. Ask SHALL expose exactly these typed tools: `search_notes`,
   `read_note_section`, `query_issues` and `final_answer`.
2. The service SHALL reject any other tool call, and SHALL give the Ask run
   only read access to the workspace. An Ask run SHALL leave notes,
   `projects.json`, `issues.json` and the review journal byte-for-byte
   unchanged. Only the conversation file may be written.
3. Retrieval SHALL reuse the section search, heading resolution and
   structured issue data. Issue facts such as status and due date SHALL
   come from records, not text search.
4. Values that are pending review SHALL be reported as proposed, and the
   accepted value SHALL be given as the fact.

### Requirement 5: Grounding (PRD-052, PRD-053, PRD-055)

1. Each retrieved source SHALL get a run-scoped handle. The service SHALL
   validate every citation before rendering:
   - an unknown handle SHALL be removed and counted;
   - a fact left with no valid source SHALL become a suggestion marked
     "not supported by a cited source".
2. The answer SHALL keep facts, discrepancies and suggestions apart, and
   SHALL say when the evidence is insufficient.
3. The answer SHALL show what was consulted, including projects and note
   sections, and SHALL say when the scope was limited.
4. A citation SHALL open the exact heading or issue, and offer a way back to
   the conversation. A heading that has since been renamed or removed SHALL
   open the note with "heading not found".
5. Workspace text SHALL be passed to the model as quoted data. Text that
   looks like instructions SHALL NOT widen what the run may do.
6. For a profile that supports structured output but not tool calling, Ask
   SHALL use retrieval-first mode:
   1. the service retrieves;
   2. the service supplies the results with their handles;
   3. the model returns the answer JSON.
7. (Added in the corrective pass, 2026-11-24.) A claim that no issue
   tracks something SHALL be shown as a recorded fact only if the run read
   every issue record. Otherwise it SHALL be shown under "Not confirmed",
   with how many records were read. Issue queries SHALL page, so that the
   model can read the rest or make a targeted lookup.
8. (Added in the corrective pass.) Search snippets SHALL show the same
   accepted note text as section reads, with pending edits reported as
   proposed.

### Requirement 6: Home and conversations (PRD-010)

1. Home SHALL show the active workspace and model, and a composer that
   asks.
2. Home SHALL show useful states for loading, cancelling, failure with
   retry, and AI off.
3. Conversations SHALL be saved in `.nexus/conversations/<id>.json` through
   the workspace service, and listed on Home.
4. Edit SHALL be visible but unavailable, with an explanation.
5. Output from the test double, or from any replay, SHALL be labelled as a
   fixture wherever it is shown.

### Requirement 7: Proof

1. In the kickoff sample, the user asks: "Which action from the kickoff
   still has no issue?" The answer SHALL name Will's judge-instructions
   action as untracked and NEX-1 as tracking the calendar work. It SHALL
   cite the Actions heading and NEX-1, and both citations SHALL open.
2. After the user creates the missing issue by hand, asking again SHALL
   report that it is tracked.
3. A second fictional workspace, with different names and keys, SHALL give
   answers that match its own data.
4. A live check against a real free route SHALL be run only if a configured
   free profile exists. Otherwise the exact steps SHALL be left for Will,
   and Q1 stays open.
