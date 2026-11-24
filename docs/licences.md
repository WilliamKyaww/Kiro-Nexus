# Licences and incorporated work

This page lists the third-party work in the repository, or used to build
it. The rules require disclosure of pre-existing work beyond standard
frameworks, libraries and templates.

## Committed third-party files

| Item | Location | Source | Licence |
| --- | --- | --- | --- |
| Impeccable skill 4.10.0 (Kiro dev tool) | `.kiro/skills/impeccable/` | <https://github.com/pbakaus/impeccable> via npm `impeccable` | Apache-2.0 (`.kiro/skills/impeccable/LICENSE`) |

## Dev tools run but not committed

| Item | Version | Licence |
| --- | --- | --- |
| `@playwright/mcp` (run with `npx`) | 0.0.86 | Apache-2.0 |

## npm dependencies (exact pins in `package.json` and `package-lock.json`)

All of these were installed from the public npm registry on 24 November
2026.

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `@fastify/static` | 10.1.12 | MIT | Serves the built UI |
| `@tanstack/react-query` | 5.108.4 | MIT | UI server state |
| `chokidar` | 6.0.0 | MIT | File watching (B2) |
| `fastify` | 5.12.8 | MIT | Local HTTP service |
| `github-slugger` | 2.0.0 | ISC | Heading slugs |
| `mdast-util-find-and-replace` | 3.0.5 | MIT | Wikilink and issue-key preview plugin |
| `minisearch` | 7.2.0 | MIT | Section search (B2) |
| `react`, `react-dom` | 19.3.1 | MIT | UI |
| `react-markdown` | 10.1.0 | MIT | Markdown preview. It renders no raw HTML |
| `react-router` | 8.5.2 | MIT | UI routing |
| `remark-gfm` | 4.0.1 | MIT | GitHub-flavoured Markdown |
| `ulid` | 3.0.2 | MIT | Stable IDs |
| `zod` | 4.6.7 | MIT | Schemas and validation |
| `@playwright/test` (dev) | 1.65.1 | Apache-2.0 | E2E tests |
| `@types/*` (dev) | see lockfile | MIT | Types |
| `@vitejs/plugin-react` (dev) | 6.3.0 | MIT | Build |
| `electron` (dev) | 45.4.1 | MIT | Desktop wrapper |
| `esbuild` (dev) | 0.28.2 | MIT | Node bundles |
| `fast-check` (dev) | 4.11.0 | MIT | Property tests |
| `typescript` (dev) | 7.0.2 | Apache-2.0 | Type checking |
| `vite` (dev) | 8.3.8 | MIT | UI build |
| `vitest` (dev) | 5.1.1 | MIT | Unit and integration tests |

The installed tree has 243 packages. On 24 November 2026 their licences
were:

| Licence | Packages |
| --- | --- |
| MIT | 210 |
| ISC | 10 |
| Apache-2.0 | 8 |
| BlueOak-1.0.0 | 7 |
| BSD-3-Clause | 5 |
| MPL-2.0 | 2 |

The two MPL-2.0 packages are `lightningcss` and its Windows binary. Vite
uses them at build time, and neither is shipped in the built output.

## Pre-existing work

None. The repository history before 24 November 2026 holds only a one-line
`README.md`, which was later deleted. Nexus code is written fresh.
Inspiration products named in the brief contributed no code, assets or
configuration.
