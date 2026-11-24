# Kiro development tooling (W4)

This page covers tools that Kiro uses while developing Nexus. They are
separate from Nexus runtime integrations such as AI providers and runtime
MCP (R-S9).

## Inventory (checked on 2026-11-24)

| Location | Found |
| --- | --- |
| Workspace `.kiro/` | `steering/` and `specs/`. There were no skills, hooks or `settings/mcp.json` before this run |
| User `~/.kiro/settings/` | Empty. There was no user `mcp.json` |
| User `~/.kiro/skills/` | Absent |
| User `~/.kiro/powers/` | Only `registries/`, so no installed powers |
| Impeccable at user level | `npx impeccable install` reported an existing **Impeccable 4.5.2** "installed for all projects", stored outside `~/.kiro/skills`. I left it untouched |
| Browsers | Microsoft Edge and Google Chrome (system installs), plus cached Playwright browsers in `%LOCALAPPDATA%\ms-playwright` |

## Integrations

### Impeccable skill: configured and verified

- **Source:**
  - npm package `impeccable@4.10.0`, published from
    <https://github.com/pbakaus/impeccable> (maintainer `paulbakaus`).
  - Apache-2.0. The licence text is copied to
    `.kiro/skills/impeccable/LICENSE`.
- **Install:**
  - Workspace scope, with
    `npx impeccable@4.10.0 install --providers=kiro --scope=project --no-hooks -y`.
  - It wrote `.kiro/skills/impeccable/` (63 files, 2.3 MB). It also put an
    engine binary in `%USERPROFILE%\.impeccable\bin\0.1.27\`, which sits
    outside the repository.
  - I passed `--no-hooks`, so Impeccable did not add a hook of its own.
- **Telemetry:**
  - Telemetry is **on** by default, covering the "roll" request and the
    choice ping.
  - Every Kiro invocation in this run set `IMPECCABLE_NO_TELEMETRY=1` and
    `DO_NOT_TRACK=1`.
  - I didn't change the global setting. A human can turn it off for good
    with `npx impeccable telemetry off`.
- **Purpose:** wireframe critique, the mechanical anti-pattern detector, and
  accessibility and layout checks (R-K2).
- **Verification:**
  1. Kiro listed the skill as `skill::impeccable` and loaded it.
  2. `impeccable context` ran.
  3. `impeccable detect` over `wireframe/` found one real issue: a
     cream-palette warning. I fixed it, and a re-run returned `[]`.
  4. `impeccable shot` rendered the page at 1440×900 and 390×844. The
     390-pixel render exposed a squashed layout and a review bar that showed
     even when hidden. Both are fixed and checked in a new render.
- **No sign-in needed.** `npx impeccable login` is optional, and I did not
  use it.

### Microsoft Playwright MCP: server verified, but Kiro registration needs a human

- **Source:** npm `@playwright/mcp@0.0.86`, from
  <https://github.com/microsoft/playwright-mcp>. Apache-2.0. Its server
  reports Playwright `1.66.0-alpha-2026-11-18`.
- **Purpose:** to drive the web UI in an isolated, headless browser with
  synthetic data (R-K3).
- **Verification, using the Nexus stdio MCP client in
  `scripts/mcp-smoke.mjs`:** all 6 checks passed.
  1. The server initialised.
  2. Tool discovery returned 25 tools.
  3. The wireframe loaded in the no-key state.
  4. The fixed demo changes opened the note with the first change.
  5. Next moved to the issue page.
  6. Reject reversed the date and asked for feedback.

  Rerun it with `node scripts/mcp-smoke.mjs`.
- **Defect found:** I first allowed `--allowed-origins http://127.0.0.1`.
  Edge then blocked `http://127.0.0.1:<port>`, because the allowed origin
  must include the port. The smoke test now uses a fixed port (47101), and
  the configuration below names every origin with its port.
- **Blocked:** Kiro's permission policy refuses agent writes to
  `.kiro/settings/`, so I could not register the server with Kiro. I did
  not try to work around the policy. As a result, **discovery by Kiro
  itself is unverified.**
- **Human action needed:**
  1. In Kiro, open the MCP configuration with the command palette:
     **"Kiro: Open workspace MCP config (JSON)"**. You can also create
     `.kiro/settings/mcp.json` by hand.
  2. Paste the configuration below and save.
  3. Open the **MCP Servers** view in the Kiro panel and confirm that
     `playwright` shows as connected with its tools listed. Approve the
     server if Kiro asks.

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["--yes", "@playwright/mcp@0.0.86", "--isolated", "--headless",
               "--browser", "msedge",
               "--allowed-origins", "http://127.0.0.1:47101;http://127.0.0.1:47100",
               "--output-dir", ".tmp/playwright-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Port 47101 is the wireframe (`node scripts/serve-static.mjs wireframe
47101`), and 47100 is the fixed port `npm run try` uses for the app. The
configuration holds no credentials.

### Kiro hook: review and reversal tests

This is added in milestone C, once the tests exist. Its verification result
is recorded there.
