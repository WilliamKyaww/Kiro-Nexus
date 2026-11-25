---
inclusion: always
---

# Source boundaries

## Off limits

Will's internal tools, Manuscript, Temporal, freellmapi and Clockwork, are
feature inspirations only. The rule covers both spellings of their folder:

- `C:\Users\willi\Documents\Verdanta Internal Tools`, where they actually
  are (found on 25 November 2026, `docs/journal/2026-11-25.md`);
- `C:\Users\willi\Documents\Verdanta\Internal Tools`, the spelling this file
  first used, which does not exist.

Do not:

- open, read, list, search or index any file there;
- add the folder to this workspace, or point an MCP server, skill, hook or
  sub-agent at it;
- copy its source, configuration, prompts, tests, assets or Git history;
- ask a reviewer (Codex, Claude Code or a Kiro sub-agent) to consult it.

The product descriptions in `docs/intake/2026-11-24-product-brief.md` are
sufficient. If a task appears to need those projects, stop and ask Will.

### Visual references (DEC-026, DEC-028)

When Will explicitly asks for a visual reference to one of these tools, or
describes one of his screenshots:

- The permission covers visible behaviour and visual hierarchy only. Build
  Nexus's own layout, names, tokens, controls and code.
- Run a tool only on an empty scratch vault or data folder in an isolated
  browser session, never on Will's real data.
- Keep repositories, source, history, assets, configuration, vaults, chats
  and private captures out of the workflow and out of Git.
- Captures stay local. Public-product captures go in
  `docs/design/references/` (ignored by Git) with their source and the
  choice they informed. Captures that show real data stay in
  `.tmp/ui-reference/<tool>/private/`.

## Allowed references

- `C:\Users\willi\Documents\Verdanta\Agentic-Engineering-Setup`: workflow
  template. Adapt its conventions in your own words. Do not copy files from
  it.
- `C:\Users\willi\Documents\GitHub\Cool Projects\Kiroween-reference`: saved
  Devpost pages. Cite the live pages, <https://kiroween.devpost.com/> and
  <https://kiroween.devpost.com/rules>. The saved copies are the local
  reference.
- Public products named in the brief (Open WebUI, ChatGPT, Codex, Obsidian,
  Jira, Hermes Agent, FreeLLMAPI), and Linear, Notion and monday.com, which
  Will added for the design work: borrow behaviours, not code, assets or
  branding. Nexus uses an original visual identity. Their captures stay in
  the ignored `docs/design/references/`.
- <https://kiro.dev/docs/> for Kiro features and configuration.

## Third-party and pre-existing work

Record every incorporated library, asset or snippet, with its licence, in
`docs/licences.md` when the first one is added. The rules require disclosure
of pre-existing work beyond standard frameworks, libraries and templates.
