# Nexus PRD: technology stack

- **Status:** Approved by Will at `7b775cd` (2026-11-24); amendments 1-4 applied (DEC-011 to DEC-014)
- **Last updated:** 2026-11-24
- **Rule:** choose the smallest maintained option that meets a PRD
  requirement. Exact versions are pinned when the project is scaffolded
  (B1), after checking the current releases. Each dependency is recorded in
  `docs/licences.md` when it is added.

## 1. Runtime and language

| Choice | Reason | Alternatives considered |
| --- | --- | --- |
| **TypeScript** (strict) everywhere | One language for UI, service, Electron and shared schemas | JavaScript (loses the typed contracts with Hein's fixtures) |
| **Node.js 24.14.0** for development and for the browser route, pinned in `.nvmrc` with `engines: ^24.14.0 \|\| >=26` (DEC-013) | It is installed on the dev machine and meets every toolchain requirement checked on 24 November 2026. The strictest are chokidar 6 (`>=22.22`), Vitest 5 (`^24` or `>=26`) and Electron 45 (`>=22.12`) | Node 26 LTS. It is current, but upgrading Node system-wide needs a human decision |
| **Electron's bundled Node** runs the service in the desktop app | Electron ships its own Node. Its version is recorded in `docs/toolchain.md` after installation, and the service must run on both versions | Running the system Node from Electron (two runtimes to support, and it fails on judges' machines that have no Node) |
| **One root package**, with TypeScript path aliases for `packages/*` | A single lockfile and one set of scripts. The bundlers resolve the aliases directly | npm workspaces (they add symlinks and per-package manifests and solve no current problem); pnpm or Turborepo (extra tools) |

Sources: [Node.js releases](https://nodejs.org/en/blog/release) and
[endoflife.date](https://endoflife.date/nodejs), checked 24 November 2026.

## 2. Packages by area

### UI (`apps/web`)

| Need | Choice | Alternatives considered |
| --- | --- | --- |
| Framework and build | **React** with **Vite** | Svelte (the team knows React better); Next.js (it needs a server, which conflicts with local-first) |
| Routing | **React Router** | TanStack Router (also fine; React Router is more familiar) |
| Server state | **TanStack Query**, plus a small SSE hook that invalidates queries | Redux (more than this needs) |
| Markdown editor | **CodeMirror 6** with `@codemirror/lang-markdown` | Monaco (heavy); a plain textarea (no folding, weaker accessibility) |
| Markdown preview | **unified, remark-parse, remark-gfm, remark-rehype, rehype-sanitize**, plus Nexus wikilink and issue-key plugins in `packages/markdown` | markdown-it (we want the mdast parser shared with the service for sections) |
| Board drag and drop | **dnd-kit**, which has built-in keyboard sensors and screen-reader announcements | Native HTML drag and drop (poor keyboard support) |
| Calendar | Hand-built month and agenda grid, using the date library below | FullCalendar (large, and harder to match the Nexus identity) |
| Styling | Plain CSS with custom properties (design tokens) and CSS modules | Tailwind (fine, but tokens alone keep the identity original and simple) |

### Local service (`server`)

| Need | Choice | Alternatives considered |
| --- | --- | --- |
| HTTP and SSE | **Fastify** | Hono (lighter, but Fastify has a more mature Node plugin set); Express (validation is weaker) |
| Validation and schemas | **Zod**, shared from `packages/schema`, generating JSON Schema for the data-format documentation and for provider tool definitions | io-ts or TypeBox (less familiar) |
| File watching | **chokidar** | `fs.watch` recursive (works on Windows but has rough edges with atomic renames) |
| Full-text search | **MiniSearch**, held in memory | FlexLunr or Lunr (MiniSearch supports incremental updates); SQLite FTS (more than the MVP needs) |
| IDs | **ulid** with type prefixes | UUID v7 (also fine) |
| Ordering | **fractional-indexing** | Integer ranks (need renumbering) |
| Dates and time zones | **Luxon** (IANA zones, DST-safe arithmetic). Switch to the built-in `Temporal` only if both the Node and Electron runtimes ship it unflagged at scaffold time | date-fns-tz (works, but its zone API is clumsier) |
| Provider client | **Direct `fetch`** to the OpenAI-compatible `/chat/completions` endpoint, with our own typed tool loop | The OpenAI SDK (acceptable, but adds a dependency for one endpoint); LangChain or LangGraph (no requirement justifies them, D-S3) |

### Desktop (`apps/desktop`)

| Need | Choice | Alternatives considered |
| --- | --- | --- |
| Shell | **Electron**. The service runs in `utilityProcess` and the renderer loads the service URL | Tauri (it has no Node runtime for the shared service, and rewriting the service in Rust is out of scope) |
| Secrets | **`safeStorage`**, which uses DPAPI on Windows, and a session-only fallback if it is unavailable | keytar (archived); plain files (unacceptable) |
| Packaging | **Electron Forge** with the zip maker for Windows x64, giving a portable folder with no installer | electron-builder (also good; Forge is the Electron team's tool); Squirrel installer (unnecessary for judges) |
| Signing | Unsigned for the hackathon. Document the SmartScreen "More info → Run anyway" step | Code-signing certificate (cost and time) |

## 3. AI providers

Nexus supports one protocol, the **OpenAI-compatible chat completions API**,
with tool calling. Profiles store the base URL, the model and the tested
capabilities. A free route must be **verified during slice C** (PRD-074).
Free catalogues change often, so the candidates below are not choices yet.

| Candidate | Why it is a candidate | Check before relying on it |
| --- | --- | --- |
| Google Gemini API (AI Studio key) through its OpenAI-compatibility endpoint | Free tier, no card, strong tool calling | Current free quota, tool-calling behaviour through the compatibility layer, and whether free-tier prompts may be used for training |
| Groq | Free tier, fast, OpenAI-compatible, open-weight models with tool support | Daily request limits and which models support tools |
| OpenRouter `:free` models | One key for many models | A low daily request cap on free models, a model list that rotates, and some free providers may train on prompts |
| Ollama (local) | No account or key, works offline, OpenAI-compatible endpoint | Download size, the hardware judges have, and the quality of tool calls from small models |

Candidate list based on
[OpenRouter's comparison of free LLM APIs](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
and [Apidog's October 2026 summary](https://apidog.com/blog/free-ai-api/).
The content was rephrased for compliance with licensing restrictions.
Quotas are deliberately not quoted here, because they must be checked
against each provider's own page in slice C.

**Data note:** free tiers may use prompts for training. The sample workspace
is synthetic, and the Settings page warns the user before they send real
notes to a provider.

**Judge route (D-E1, amended by DEC-014).** Slice C keeps the live
free-provider route open. Two routes are considered:

- A judge supplies their own free API key. This is one option, not the
  default assumption.
- A **team-provided evaluation route** lets judges try the AI workflow
  without creating an account. This is a release requirement still to be
  resolved (PRD-091). It must not bundle a private key in the
  distributable, and it must stay free of charge until judging ends.

A scripted replay can demonstrate the interface, and is always labelled as a
replay. It cannot verify live AI behaviour, and is never evidence for it.
Tonight's work (24 November) uses fictional data and no provider credentials.

## 4. Testing and quality

| Need | Choice | Purpose |
| --- | --- | --- |
| Unit and integration tests | **Vitest** | Service, journal, scheduler, schemas, Markdown parsing |
| Property-based tests | **fast-check** | Journal invariants: applying then rejecting a change restores the `before` content; rejecting one change never alters another; dedup keys are unique across time-zone changes |
| End-to-end tests | **Playwright** (browser and `_electron`) | Journeys J1 to J8 and the Electron smoke test |
| Accessibility | **@axe-core/playwright**, plus a manual keyboard-only pass | PRD-080 |
| Lint and format | **ESLint** (typescript-eslint) and **Prettier** | Consistency |
| Secret scan | A small test that searches the workspace, logs and the package for known key patterns and test keys | PRD-076 |

Property-based testing is also one of the Kiro features the judges ask
about. The journal invariants are a real use for it.

## 5. Kiro development tooling (work item 4)

These tools are for Kiro as the development agent. They are separate from the
Nexus runtime.

| Tool | Purpose | Status |
| --- | --- | --- |
| Native specs (`.kiro/specs/`) | Requirements, design and tasks for each slice | In use from B1 |
| Steering (`.kiro/steering/`) | Workflow, source boundaries, and the product, tech and structure foundations | In use |
| Impeccable skill | Wireframe critique and accessibility review | To check in W4 (R-K2) |
| Playwright MCP (Microsoft) | Drives the web UI in an isolated browser with synthetic data | To configure in W4 (R-K3) |
| Hook: review and reversal tests | Runs the focused journal tests when files under `server/src/review/**` or `server/src/workspace/**` change | Added once those tests exist (R-K5) |

**Runtime MCP (R-S9)** is a separate, optional decision, deferred to P1.

## 6. Commands (planned, created in B1)

| Command | Effect |
| --- | --- |
| `npm run dev` | Service and Vite dev server. Opens the browser with a token URL |
| `npm start` | Builds the UI and serves it from the service (the browser route for judges) |
| `npm run desktop` | Electron against a local build |
| `npm test` | Vitest, all packages |
| `npm run test:e2e` | Playwright journeys |
| `npm run package:win` | Electron Forge Windows zip |
