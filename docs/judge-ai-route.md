# How judges can try the AI workflow (Q1 and Q5, PRD-091)

- **Status (2026-11-24):**
  - **No live route has been tested yet.** Q1 stays open until a real free
    call succeeds.
  - Everything below is a proposal, unless it is marked as tested.
- **Rule (DEC-014):** the distributable never contains a private provider
  key. A scripted replay or the test double can show the interface, but
  neither is evidence of live AI behaviour.

## What has been verified

| Route | Status | Evidence |
| --- | --- | --- |
| Deterministic test double (`tools/provider-double/server.mjs`) | Tested. It is a fixture, not AI | `npm test` and `npm run test:e2e` (the C1 to C4 specs) |
| Groq free plan, `openai/gpt-oss-20b` (Settings template) | **Not tested.** It is a candidate only | None yet. See "Live check" below |
| Team-provided relay (Option A below) | **Proposed, not built** | None |

## Live check (for Will, using his own free key)

1. Create a free key at <https://console.groq.com/keys>. No card is needed
   for the free plan.
2. In the Nexus folder, in a PowerShell window, run:

   ```powershell
   npm run build
   npm run live:check
   ```

3. When asked, paste the key and press Enter. The prompt shows `*` for
   each character, so the key never appears on screen, in your PowerShell
   history or in an environment variable. Esc or Ctrl+C cancels without
   sending anything.
4. The script works on a disposable copy of the fictional sample:
   1. It starts a separate Nexus service with a temporary profile. The
      key goes to that service over its local API, and from there only to
      the provider.
   2. It probes tool calling and structured output.
   3. It asks "Which action from the kickoff still has no issue?"
   4. It checks the answer: a recorded fact must name "Will writes the
      judge instructions" as having no issue and cite the kickoff's
      Actions heading, and a fact or discrepancy must cite NEX-1 for the
      calendar work. Both citation targets must exist.
   5. It stops the service and deletes the temporary profile, whatever
      the outcome. The key, any fragment of it and key-shaped strings are
      removed from the console output and from the report in
      `.tmp/live-check/`.
5. Read the result line and the exit status:

   | Exit | Meaning |
   | --- | --- |
   | 0 | Live pass |
   | 1 | The answer failed a check (for example insufficient evidence or a missing citation) |
   | 2 | Set-up problem (no key given, service not built, unexpected HTTP response) |
   | 3 | The provider rejected the key |
   | 4 | Timed out |
   | 5 | The model showed neither tool calling nor structured output |
   | 6 | The local test double answered: a fixture never counts as a live pass |
   | 7 | Other provider error |

6. Only on exit 0, record the provider, model, date and observed
   capabilities here and in `STATE.md`, and close Q1.

Optional: set `NEXUS_LIVE_MODEL` or `NEXUS_LIVE_BASE_URL` before the
command to try another model or route.

You can also run the check in the UI:

1. In **Settings → Add a provider**, choose the Groq template.
2. Paste the key and select **Add provider**. Nexus tests it
   automatically.
3. On Home, ask the question.

## Proposed routes for judges

### Option A: team-provided relay (proposed for PRD-091, not built)

- The team hosts a tiny OpenAI-compatible relay on a free serverless tier,
  for example a Cloudflare Worker. It holds the team's free-plan provider
  key as a server-side secret, which never reaches judges or the build.
- Judges get a per-judge **access code** through the private
  testing-instructions field of the Devpost form. In Settings they add a
  profile with:
  - the relay's `https://…/v1` URL as the base URL;
  - the pinned model;
  - the access code as the "key".
- The relay:
  - accepts only `/chat/completions` for the pinned model;
  - caps requests and tokens per code per day;
  - rejects large bodies;
  - stores no prompts;
  - stops working after the judging period ends (29 January 2027).
- Nexus needs no code changes, because the relay is an ordinary
  OpenAI-compatible profile.
- **Open checks before building:**
  - Do the provider's terms allow relaying a free-plan key for other
    people's use?
  - Is the free quota enough for the expected number of judges?
  - How are misuse and code revocation handled?

### Option B: the judge's own free key

The judge follows the Groq steps in the live check. This costs nothing, but
it needs an account.

### Option C: a local model, with no account

Ollama's OpenAI-compatible endpoint (`http://127.0.0.1:11434/v1`) is
allowed, because it runs on the same computer. It needs a model download
and suitable hardware, and the quality of its tool calls varies. It is
untested here.

### Not a route: replay or the test double

Fixture output is always labelled in the UI. It shows the interface only.
