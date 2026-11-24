# Design: B1 workspace core

- **Traces to:** `requirements.md`, `docs/PRD/architecture.md` sections 1
  to 6 and 7.6, and DEC-005, DEC-006, DEC-011 and DEC-013.
- **Review:** Kiro self-review only (see the end of this file). No human
  review yet.

## Overview

```
npm run try / open ──► server/dist/main.js ◄── Electron main (utilityProcess)
                            │  Fastify on 127.0.0.1:<port>
browser / renderer ─HTTP──► │  guard: Host check → static shell | /api/v1 (bearer)
                            │  WorkspaceService ── atomic writes ──► workspace/
                            │  Profile (service.json, recent.json)
```

## Components

| Module | Responsibility |
| --- | --- |
| `packages/schema` | Zod schemas and types: `WorkspaceManifest`, `Project`, `Issue`, `NoteLink`, `Due`, and the API request and response bodies. Also the deterministic JSON serialiser |
| `packages/markdown` | `parseHeadings(md)`: ATX headings outside fenced code, with github-slugger slugs and line numbers. `parseWikilinks(md)`. A remark plugin that turns `[[wikilinks]]` into `nexus:` links for the preview |
| `server/src/security` | Launch codes (single use, 2-minute expiry), session tokens, the control secret, constant-time comparison, Host and bearer guards, and a redacting request logger |
| `server/src/workspace/atomic.ts` | `atomicWrite(path, bytes)`: writes a temporary file in the same folder, `fsync`s it, renames it with retry on `EPERM`/`EBUSY`, then `fsync`s the folder. Also `sha256(bytes)` |
| `server/src/workspace/lock.ts` | `acquireLock`, `releaseLock`, and a liveness check with `process.kill(pid, 0)` |
| `server/src/workspace/paths.ts` | `resolveNotePath(root, rel)`, which rejects absolute paths, `..`, dot-segments, non-`.md` files and escapes after `realpath` |
| `server/src/workspace/service.ts` | `WorkspaceService`. It opens or initialises a workspace, handles notes (list, read, create, save with a base revision), handles projects and issues (list, create, update with a base revision), and reports linked issues for a note. It keeps JSON collections in memory and writes each one atomically |
| `server/src/profile.ts` | `service.json` (port, pid, control secret), `recent.json`, and resolving the profile folder (`NEXUS_PROFILE_DIR`, otherwise `%APPDATA%/Nexus`) |
| `server/src/app.ts` | `createApp()`: Fastify, the guards, the routes, the static shell and the authenticated `/events` stream (a heartbeat plus `file.changed`) |
| `apps/web` | React shell, routes, an API client (session bootstrap, bearer fetch, fetch-stream events), Notes, Projects and Issue pages, and placeholders |
| `apps/desktop` | Electron `main.ts` (profile, service, launch code, window security) and `preload.ts` (`nexusNative`) |
| `scripts/` | `build.mjs` (esbuild for the server, desktop and preload bundles); `try.mjs` (disposable sample copy plus an isolated profile, then start and open); `open.mjs` (mints a new launch URL) |

## Data model (version 1)

```ts
WorkspaceManifest { schemaVersion: 1; workspaceId: `wsp_${ulid}`; name; timeZone; createdAt }
ProjectsFile { schemaVersion: 1; projects: Project[] }
Project { id: `prj_${ulid}`; key: /^[A-Z][A-Z0-9]{1,9}$/; name; nextIssueNumber; createdAt; updatedAt; revision }
IssuesFile { schemaVersion: 1; issues: Issue[] }
Issue { id: `iss_${ulid}`; key: `${projectKey}-${n}`; projectId; title; description;
        status: 'todo'|'in_progress'|'done'; priority: 'low'|'medium'|'high'|'urgent';
        due: null | { date: 'YYYY-MM-DD' } | { dateTime: ISO-UTC; timeZone: IANA };
        rank: string; noteLinks: NoteLink[]; createdAt; updatedAt; revision }
NoteLink { notePath; headingSlug: string|null; headingText: string|null }
```

JSON is written with `serialise(value)`, which uses two-space indentation,
keys in schema order and a trailing LF. Its output is therefore
deterministic, which DEC-012 relies on. `rank` is an increasing string in
B1. B3 replaces it with fractional indexing.

## API (B1 subset of architecture section 4.1)

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/launch-codes` | control secret | Mint a launch code (launcher only) |
| `POST /api/v1/session` | launch code in the body | Exchange the code for `{ token }` |
| `GET /api/v1/workspace` | bearer | Current workspace, or `null`, plus the recent list |
| `POST /api/v1/workspace/open` | bearer | `{ path }`. Opens or initialises the folder. `423` if locked |
| `POST /api/v1/workspace/sample` | bearer | `{ targetPath }`. Copies the sample there and opens it |
| `GET /api/v1/notes` | bearer | Tree of `.md` paths |
| `GET /api/v1/notes/content?path=` | bearer | `{ path, content, revision, headings, linkedIssues }` |
| `POST /api/v1/notes` | bearer | `{ path, content }`. Creates the note. `409` if it exists |
| `PUT /api/v1/notes/content` | bearer | `{ path, content, baseRevision }`. Saves. `409` if stale |
| `GET/POST /api/v1/projects` | bearer | List or create projects |
| `GET /api/v1/issues?projectId=` | bearer | List issues |
| `POST /api/v1/issues` | bearer | Create an issue |
| `GET /api/v1/issues/:key` | bearer | Issue with resolved links |
| `PATCH /api/v1/issues/:key` | bearer | `{ baseRevision, patch }`. `409` if stale |
| `GET /api/v1/events` | bearer | `text/event-stream` |

The note path travels in the query string, which is acceptable because it
is not a secret. The request logger records only the route pattern, not the
URL, so note paths do not reach the logs either.

## Key flows

**Launch.**
1. `try.mjs` builds the workspace and profile paths and spawns
   `node server/dist/main.js --profile P --workspace W`.
2. The service writes `service.json` atomically and prints
   `{"event":"ready","port":N}`.
3. `try.mjs` reads the control secret from `service.json`, mints a code
   with a POST, and opens `http://127.0.0.1:N/#launch=CODE`.

**Session bootstrap (web).**
1. `api.ts` runs before React renders.
2. If the fragment has `launch=`, it calls `replaceState` to clear it, then
   POSTs `/session`, then stores the token in `sessionStorage`.
3. Otherwise, if `sessionStorage` has a token, it uses that token.
4. Otherwise it renders the "Open from launcher" screen.
5. Any `401` returns the UI to that screen.

**Heading link resolution.** This happens on the server, in
`GET /issues/:key` and in `linkedIssues`. For each link, the service parses
the target note's headings. It first looks for the exact slug. Failing that,
it looks for a unique heading with the same text. The result is
`{ ...link, resolved: { exists, headingSlug|null, status: 'ok'|'heading-missing'|'note-missing' } }`.

**Stale save.** `PUT` compares `baseRevision` with the current hash of the
file on disk, read at request time. A mismatch returns `409` with the
current content. The editor keeps its buffer and shows the conflict banner.

**Electron.**
1. `main.ts` resolves the profile (`NEXUS_PROFILE_DIR`, otherwise
   `app.getPath('userData')`).
2. It calls `app.setPath('userData', profile)` and creates the control
   secret.
3. It runs `utilityProcess.fork(server/dist/main.js)`, passing the secret
   in the environment and capturing stdout.
4. On the ready line, it mints a code and calls `BrowserWindow.loadURL`.
5. On `before-quit`, it calls `child.kill()`. The service handles
   termination by releasing the lock.

## Error handling

Stable codes: `UNAUTHENTICATED` (401), `FORBIDDEN_HOST` (403),
`BAD_PATH` (400), `VALIDATION` (400), `NOT_FOUND` (404), `EXISTS` (409),
`REVISION_MISMATCH` (409), `LOCKED` (423), `NO_WORKSPACE` (409) and
`INVALID_DATA` (500, with the file name).

## Testing strategy

| Level | What | Tool |
| --- | --- | --- |
| Unit | Headings and slugs; path validation; atomic write; the serialiser's determinism; launch-code single use and expiry | Vitest |
| Integration | The real service on an ephemeral port against a temp workspace: auth matrix (no token, wrong Host, reused code, events), note and issue CRUD, `409` on a stale save, lock contention between two services, persistence across a restart, links in both directions, log scan for secrets | Vitest, child processes |
| E2E (browser) | Fresh-session launch → create note → create project and issue → link heading → navigate both ways → restart service → relaunch → both intact | Playwright (Chromium) |
| E2E (Electron) | Launch with an isolated profile → window shows the workspace → create a note → quit → relaunch → note present | Playwright `_electron` |

## Simplifications in B1 (recorded for review)

- The editor is a `<textarea>` with a preview. CodeMirror 6 (techstack)
  moves to B2.
- The project page is a sorted list, not a board. Hein's B3 owns the board.
- A browser can't show a native folder picker, so the web UI takes a typed
  folder path. Electron uses `pickWorkspaceFolder()`.

## Self-review (Kiro, 2026-11-24)

- **Checked:** every requirement maps to a component and to a test level.
  The auth matrix covers each clause of DEC-011.
- **Fixed during review:** the first draft put the note path in a URL path
  segment, which is awkward for nested folders and for encoding spaces on
  Windows. It now uses `?path=`, and the logger records only the route
  pattern.
- **Residual risk:** `process.kill(pid, 0)` can treat a reused pid as live.
  That makes the service refuse to open the workspace, which is the safe
  failure. It is recorded in the error message so that a human can delete
  the stale lock.
