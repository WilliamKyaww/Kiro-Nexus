# Nexus PRD: architecture

- **Status:** Approved by Will at `7b775cd` (2026-11-24); amendments 1-4 applied (DEC-011 to DEC-014)
- **Last updated:** 2026-11-24
- **Traces to:** `structure.md` (PRD-xxx); intake R-*/D-*; decisions
  DEC-005 to DEC-014.

## 1. System overview

```
┌───────────── Browser tab ─────────────┐   ┌──────── Electron (Windows) ────────┐
│ React UI (apps/web)                   │   │ main: window, native notify,       │
│                                       │   │       secrets (safeStorage),       │
│                                       │   │       starts local service         │
│                                       │   │ preload: window.nexusNative (tiny) │
│                                       │   │ renderer: same React UI, sandboxed │
└──────────────┬────────────────────────┘   └──────────────┬─────────────────────┘
               │ HTTP JSON + SSE, 127.0.0.1, session token  │
               └──────────────────┬─────────────────────────┘
                     ┌────────────▼─────────────┐
                     │ Local service (server/)  │  single writer per workspace
                     │  WorkspaceService        │◄── file watcher (external edits)
                     │  ReviewJournal           │
                     │  SearchIndex (memory)    │
                     │  Scheduler               │
                     │  Coordinator + tools     │──► OpenAI-compatible provider
                     │  ProviderRegistry        │
                     └────────────┬─────────────┘
                 atomic writes    │
         ┌────────────────────────▼──────────────────────┐
         │ Workspace folder (user's)                     │
         │  **/*.md            notes                     │
         │  .nexus/*.json      projects, issues, ...     │
         │  .nexus/reviews/    review journal            │
         └───────────────────────────────────────────────┘
```

Every read and write of workspace data goes through the local service.
Manual edits from the UI and agent proposals use the same `WorkspaceService`
operations (R-C6, PRD-067). The UI holds no authoritative state.

## 2. Repository layout

One root `package.json` with a single lockfile. Shared code in `packages/` is
imported through TypeScript path aliases (`@nexus/schema`,
`@nexus/markdown`). esbuild, Vite and Vitest resolve these aliases, so
packages need no build step or symlinks of their own. npm workspaces can be
introduced later if a package needs to be published separately.

```
apps/web/            React + Vite UI (browser and Electron renderer)
apps/desktop/        Electron main + preload; packaging config
server/              Local service: HTTP API, workspace, journal, index,
                     scheduler, coordinator, providers
packages/schema/     Shared Zod schemas, TypeScript types, API contracts,
                     generated JSON Schema for data files
packages/markdown/   Shared Markdown parsing: sections, headings, slugs,
                     wikilinks, issue-key mentions (used by UI and service)
samples/meeting-workspace/   Synthetic demo workspace (section 8 of structure.md)
wireframe/           Slice A static HTML/CSS/JS prototype
tests/e2e/           Playwright journeys (browser + Electron)
docs/                Intake, PRD, data format, journal, reviews, checklists
.kiro/               Steering, specs, hooks, settings (committed; never ignored)
```

Each package owns its unit tests beside the source (`*.test.ts`).

## 3. Data ownership

| Data | Location | Owner (writer) | Notes |
| --- | --- | --- | --- |
| Notes | `<workspace>/**/*.md` (excluding dot-folders) | WorkspaceService | Never annotated by Nexus (PRD-002) |
| Workspace manifest | `.nexus/workspace.json` | WorkspaceService | `workspaceId`, `name`, `timeZone`, `schemaVersion` |
| Projects | `.nexus/projects.json` | WorkspaceService | Key (e.g. `NEX`), name, `nextIssueNumber` |
| Issues | `.nexus/issues.json` | WorkspaceService | Shape in section 5 |
| Calendar events | `.nexus/calendar.json` | WorkspaceService | |
| Reminder settings | `.nexus/reminders.json` | WorkspaceService | Defaults, per-item rules, personalised opt-in |
| Delivery log | `.nexus/state/deliveries.json` | Scheduler (via WorkspaceService) | Duplicate prevention |
| Review journal | `.nexus/reviews/<runId>.json` | ReviewJournal (via WorkspaceService) | Section 7 |
| Conversations | `.nexus/conversations/<id>.json` | Coordinator (via WorkspaceService) | Messages, run IDs, citations; no keys |
| Write lock | `.nexus/lock` | Service instance | pid, port, instance ID, start time |
| Search index | Service memory | SearchIndex | Rebuilt from files at start and on change (PRD-054) |
| Provider profiles | `%APPDATA%\Nexus\providers.json` | Service | Name, base URL, model, capabilities; **no keys** |
| API keys (desktop) | `%APPDATA%\Nexus\secrets.bin` | Electron main | Encrypted with `safeStorage` (DPAPI) |
| API keys (browser) | Service memory only | Service | Cleared when the service stops |
| Recent workspaces | `%APPDATA%\Nexus\recent.json` | Service | Paths only |

Everything under `.nexus/` except `lock` and `state/` is meaningful user
data; documenting it is part of B1 (`docs/data-format.md`).

## 4. Interfaces

### 4.1 Local HTTP API (`/api/v1`)

The session model below implements amendment 1 (DEC-011).

- **Loopback only.** The service listens on `127.0.0.1`, on a free port or
  one given with `--port`. Every request whose `Host` header is not
  `127.0.0.1:<port>` or `localhost:<port>` is rejected with `403`, which
  defeats DNS rebinding. The service sends no CORS headers, so a page on
  another origin cannot read a response or send the `Authorization` header.
- **Static app shell, unauthenticated.** `GET /` and `/assets/*` serve the
  built UI. They contain no workspace data, and every other path below `/`
  (except `/api/*`) returns `index.html` for client routing. Responses carry
  a strict CSP (`default-src 'self'`; no inline script; `frame-ancestors
  'none'`).
- **Launch codes.** These are single-use, 128-bit and expire after
  2 minutes. Only the process that started the service can mint one, through
  `POST /api/v1/launch-codes` authorised by the **control secret**. The
  service writes that secret to `<profile>/service.json` (with the port and
  pid), and no HTTP response ever returns it. The service, the
  `npm run open` helper and Electron main each mint a code and open
  `http://127.0.0.1:<port>/#launch=<code>`. The code is in the URL
  fragment, which the browser never sends to the server, so it cannot reach
  a server log.
- **Session.** The UI reads the fragment, removes it with
  `history.replaceState`, and sends `POST /api/v1/session` with the code in
  the JSON body. The service burns the code and returns a 256-bit session
  token in the response body. The UI keeps the token in `sessionStorage` and
  sends it as `Authorization: Bearer <token>` on every API call. Tokens and
  codes never appear in a query string or a log line. The request logger
  records only the method, route pattern, status and duration.
- **Fresh sessions.** A new tab without a valid token shows "Open Nexus
  from its launcher" and makes no data request. `npm run open` (or
  relaunching the desktop app) mints a new code for a fresh browser session.
  All sessions end when the service stops.
- **Protected surface.** Every `/api/v1/*` route except `POST /session`
  requires a valid session token. This covers workspace data, mutations and
  the event stream. A request without one gets `401` with no data.
- **Live updates.** `GET /api/v1/events` returns a `text/event-stream`
  body, which the UI reads with `fetch` and a stream reader so that the
  bearer header is kept. `EventSource` is not used, because it cannot send
  headers.
- **Validation and errors.** All bodies are validated against
  `packages/schema` (Zod). Errors use `{ error: { code, message, details? } }`
  with stable codes such as `REVISION_MISMATCH`, `LOCKED`, `UNAUTHENTICATED`
  and `PROVIDER_RATE_LIMITED`.

| Area | Endpoints (indicative) |
| --- | --- |
| Workspace | `POST /workspace/open`, `GET /workspace`, `POST /workspace/sample` |
| Notes | `GET /notes` (tree), `GET/PUT/DELETE /notes/{path}`, `POST /notes/move`, `GET /notes/{path}/backlinks` |
| Search | `GET /search?q=` (section results) |
| Projects/issues | `GET/POST /projects`, `GET/POST /issues`, `PATCH /issues/{id}` (with `baseRevision`) |
| Calendar | `GET /calendar?from&to` (events + dated issues), `POST/PATCH/DELETE /events/{id}` |
| Reminders | `GET/PUT /reminders/settings`, `POST /reminders/test`, `GET /notifications` |
| Agent | `POST /conversations`, `POST /conversations/{id}/messages` (`mode: ask|edit`), `GET /conversations` |
| Review | `GET /reviews?state=pending`, `POST /changes/{id}/accept`, `POST /changes/{id}/reject`, `POST /changes/{id}/feedback`, `POST /changes/{id}/resolve-conflict` |
| Providers | `GET/POST/DELETE /providers`, `POST /providers/{id}/test`, `PUT /providers/{id}/session-key` (browser only) |
| Events | `GET /events` (SSE): `file.changed`, `review.updated`, `notification`, `run.progress` |

Writes carry a base revision; a stale write returns `409 REVISION_MISMATCH`
with the current value so the UI can show a conflict (PRD-023).

### 4.2 Electron preload (`window.nexusNative`)

Exposed via `contextBridge`; nothing else is reachable from the renderer.

- `pickWorkspaceFolder(): Promise<string | null>`
- `setProviderKey(profileId, key): Promise<void>` and
  `deleteProviderKey(profileId)`, `hasProviderKey(profileId)`. No read-back.
- `notificationPermission(): Promise<'granted' | 'denied'>`
- `appInfo(): { version, platform }`

Startup sequence:

1. Main starts the service as an Electron `utilityProcess`, with the
   app's isolated profile directory and a control secret that it generates.
2. Main waits for the service's ready line on stdout. The line carries the
   port and no secrets.
3. Main mints a launch code and loads `http://127.0.0.1:<port>/#launch=<code>`.

Main subscribes to the service's `notification` events and shows native
notifications; a click focuses the window and navigates to the target. Main
passes keys to the service over the private `utilityProcess` message port at
run time, never via HTTP.

Renderer settings: `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webSecurity: true`, navigation restricted to the
service origin, new windows denied, external `https:` links opened with
`shell.openExternal` after user action, strict CSP.

### 4.3 Coordinator tools

All tools are typed (Zod → JSON Schema for the provider). Results are
returned as quoted data with source handles.

| Tool | Mode | Input | Output |
| --- | --- | --- | --- |
| `search_notes` | Ask, Edit | `query`, `limit≤10` | sections `{ handle, path, headingSlug, headingText, snippet }` |
| `read_note_section` | Ask, Edit | `path`, `headingSlug?` | `{ handle, text, revision }` |
| `query_issues` | Ask, Edit | filters: `projectKey`, `status`, `text`, `dueBefore`, `keys[]` | issues with handles |
| `read_calendar` | Ask, Edit | `from`, `to` | events and dated issues with handles |
| `final_answer` | Ask, Edit | `facts[]`, `discrepancies[]`, `suggestions[]`, `insufficientEvidence`, each with `sources[]` handles | ends the run |
| `propose_changes` | **Edit only** | `operations[]` (section 7.2) | per-operation result: `pending` or a validation error |

There is no accept, filesystem, shell or network tool (R-A7, PRD-051).

## 5. Issue shape and review states (agree with Hein early, R-T2)

```json
{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "iss_01JD3M8Q4K7Y2C9X5V6B1N0RTA",
      "key": "NEX-1",
      "projectId": "prj_01JD3M7Z...",
      "title": "Build calendar view",
      "description": "Markdown text",
      "status": "todo | in_progress | done",
      "priority": "low | medium | high | urgent",
      "due": null,
      "rank": "a0",
      "noteLinks": [
        { "notePath": "meetings/2026-11-24 kickoff.md",
          "headingSlug": "actions", "headingText": "Actions" }
      ],
      "createdAt": "2026-11-24T18:00:00Z",
      "updatedAt": "2026-11-24T18:00:00Z",
      "revision": 1
    }
  ]
}
```

- `id` is a prefixed ULID, never reused; `key` is human-facing and also
  stable.
- `due` is `null`, `{ "date": "2026-12-03" }` (all-day, local) or
  `{ "dateTime": "2026-12-03T14:00:00Z", "timeZone": "Europe/London" }`.
- `rank` is a fractional-index string for ordering within a column.
- `revision` increments on every write to the record and is the record's
  base revision for edits and review.
- Note revisions are the SHA-256 of the file's bytes.

**Review states** for each change: `prepared` (journaled, not yet written),
`pending` (written, awaiting decision), `accepted`, `rejected` (reversed),
`conflicted` (reversal blocked by newer work, awaiting the user), and
`superseded` (rejected and replaced by a correction, kept for history).
Hein's fixtures use these exact strings.

## 6. Time, links and search

- **Time zones.** Instants are stored in UTC with an IANA zone. All-day dates
  are local dates interpreted in the workspace `timeZone` (default: the
  system zone at creation). Reminder rules are an offset from an instant, or a
  local time on the due date (default 09:00). The scheduler recomputes
  instants after a time-zone change or clock jump.
- **Heading links** store `notePath`, `headingSlug` and `headingText`.
  Resolution order: exact slug; otherwise a unique heading with matching
  text; otherwise the note itself with a "heading not found" marker and a
  repair action. Renames made in Nexus update links; external renames show as
  broken links with repair (DEC-006).
- **Wikilinks** `[[Name]]`, `[[Name#Heading]]` and `[[Name|alias]]` resolve
  by case-insensitive file name, preferring the closest path when several
  match. Text matching a project key pattern (`NEX-12`) renders as an issue
  link and is indexed as a backlink to that issue.
- **Search** uses an in-memory full-text index over note sections (heading
  path + body) and issue titles and descriptions. It is rebuilt at start and
  updated from watcher events. Exact facts (status, due date, priority) come
  from `query_issues`, never from the text index (R-A3).

## 7. Change review contract

### 7.1 Granularity

One **change** is the smallest unit a user would reasonably keep or undo:

- a note block edit (a paragraph, list item, checklist item or heading line),
  a block insertion or deletion, or a new note;
- one field on one record (e.g. the `due` of `NEX-1`), a new record, or a
  record deletion;
- a link added or removed (`noteLinks` entry).

A run can contain several changes across several files. A change may
declare `dependsOn` (e.g. a link to a new task depends on that task's
creation).

### 7.2 Operations and journal records

These records implement amendment 2 (DEC-012). Recovery uses only data that
is saved before any write it governs.

```json
{
  "schemaVersion": 1,
  "runId": "run_01J...",
  "source": { "kind": "agent | fixed-demo", "label": "Demo operations (fixed, not AI)",
              "conversationId": null, "model": null },
  "createdAt": "...",
  "phase": "prepared | applying | applied | partial",
  "files": [
    { "path": "meetings/kickoff.md", "beforeHash": "sha256:…", "afterHash": "sha256:…",
      "state": "planned | written | failed | conflicted", "error": null }
  ],
  "changes": [
    {
      "changeId": "chg_01J...",
      "opId": "op_01J...",
      "kind": "note.replaceBlock | note.insertBlock | note.deleteBlock | record.updateField | record.create",
      "file": ".nexus/issues.json",
      "target": { "recordId": "iss_...", "field": "due" },
      "baseRevision": 3,
      "before": { "date": "2026-12-05" },
      "after":  { "date": "2026-12-03" },
      "context": null,
      "dependsOn": [],
      "supersedes": null,
      "state": "prepared",
      "reversal": null,
      "history": [{ "state": "prepared", "at": "...", "by": "agent" }]
    }
  ]
}
```

- `opId` comes from the proposal. A second proposal that reuses an `opId`
  already in any journal is returned as a duplicate and not applied again.
  `changeId` is assigned by the service. Both are stable for the life of the
  change.
- `files[]` is computed during validation. Each entry records the file's
  hash before the run, and the hash expected after **all** of that file's
  changes in the run have been applied. Hashes are SHA-256 of the file
  bytes. For JSON, the bytes are those produced by the deterministic
  serialiser (two-space indentation, a trailing newline, keys in schema
  order), so the hash of a recomputed result is reproducible.
- **Note changes** are line-aligned text spans:
  - `before` and `after` are the exact span text, and either may be empty
    for an insertion or a deletion.
  - `context` stores `{ headingSlug, lineBefore, lineAfter }`. These are the
    nearest non-blank lines on each side of the span at proposal time, used
    to find the span again.
- **Record changes:** `before` and `after` hold the field value, and
  `baseRevision` is the record's `revision`.
- `reversal` is written just before a rejection's file write. It records the
  file's `beforeHash` (current at decision time) and the `afterHash`
  expected once only this change has been reversed. See section 7.4.

### 7.3 Apply sequence (R-C1, R-C2)

1. **Validate** every operation:
   - its schema;
   - its path, which must resolve inside the workspace with no `..` and no
     symlink escape, and must be a `.md` file or a known `.nexus/*.json`;
   - its target, which must exist (or must not exist, for creates);
   - its base revision, which must equal the current one;
   - its `before`, which must match the current content (exactly one match
     for note spans, see 7.4).

   Group the valid operations by file. Compute each file's new content in
   memory, then record `beforeHash` and `afterHash`. Invalid operations are
   returned to the caller with a reason, and nothing is written for them.
2. **Journal**: write `reviews/<runId>.json` with `phase: prepared`, every
   file `planned` and every change `prepared`. Write it atomically (section
   7.6) and `fsync` it **before** any workspace file is touched.
3. **Apply per file**, in a fixed order:
   1. Set the run's phase to `applying`.
   2. For each file, write its new content atomically.
   3. Mark that file `written` and its changes `pending` in the journal,
      using a second atomic journal write.
   4. When every file is `written`, set the phase to `applied`.

   If a file write fails, mark that file `failed` with its error. Its
   changes stay `prepared`. The remaining files are not attempted and are
   also marked `failed` ("not attempted"), so a restart never writes them
   without being asked. The run's phase becomes `partial`. Files already
   written stay `pending` and are reviewed normally. The API and UI report
   each file's actual outcome, and a repeated proposal reports the existing
   run's outcome rather than "already applied".
   - **Retry** re-plans each failed file against its *current* contents:
     1. Changes whose `before` no longer matches become `conflicted`
        (`changed-before-apply`), and nothing is written for them.
     2. The other changes get fresh `beforeHash` and `afterHash` values,
        which are journaled before the write, so unrelated newer edits are
        kept.
     3. Files already written are never rewritten.
   - **Discard** marks a failed file `discarded` and its changes
     `rejected`, with no write. Successful sibling changes are untouched.
   - Both are idempotent.
4. **Refresh**: the service emits `file.changed` and `review.updated`. Open
   editors with no unsaved edits reload in place, keeping scroll position and
   selection; editors with unsaved edits keep their buffer and show the
   conflict banner (PRD-023). The UI then navigates to the first change and
   highlights its target, then leaves a persistent "Pending review" marker.

Notes autosave (debounced about 1 s) and the UI flushes pending saves before
starting an Edit run, so agent changes rarely meet unsaved buffers.

### 7.4 Decisions (R-C3, R-C4)

- **Accept** `pending → accepted`. No file write; the content is already
  there. If the change has a `dependsOn` target that is still pending, the UI
  offers "Accept both" instead of accepting alone.
- **Reject** `pending → rejecting → rejected`, with reversal:
  1. **Locate** the change's region in the current file:
     - *Field:* the field's current value on the record.
     - *Note span:* every line-aligned occurrence of the `after` text.
       1. If there is more than one, keep only those whose nearest
          non-blank neighbours equal `context.lineBefore` and
          `context.lineAfter`.
       2. Exactly one remaining occurrence is the region.
       3. No occurrence means the span was deleted or edited, and the
          result is `conflicted` (`reason: missing`).
       4. Two or more means the span is repeated, and the result is
          `conflicted` (`reason: ambiguous`).
     - *Deletion* (`after` is empty): the insertion point is where
       `lineBefore` and `lineAfter` are adjacent and unique. Otherwise the
       result is `conflicted` (`reason: ambiguous` or `missing`).
     - *Created record:* the whole record.
  2. **Reverse**, when the region is found and equals `after`:
     1. Compute the new file content by splicing `before` into that region
        only, so unrelated edits elsewhere in the file are kept.
     2. Persist `reversal: { beforeHash, afterHash }` and set the state to
        `rejecting` in the journal.
     3. Write the file atomically.
     4. Set the state to `rejected`.
  3. **Conflict**, in every other case:
     - Mark the change `conflicted`, record the reason, and write no file.
     - Show the before, proposed and current text side by side.
     - The default action is **Keep current**, which closes the change as
       rejected with no write.
     - **Restore original** is offered only for `reason: ambiguous`. It
       asks the user to pick the occurrence, then follows step 2.
  4. Dependents: rejecting a change also rejects every pending change that
     `dependsOn` it, after the UI lists them and the user confirms (D-C1).
     They are marked `rejected` with reason `target-rejected`.
- **Feedback**: after a rejection takes effect, the UI asks "What was wrong,
  or what should be kept?" with **Skip**. A reason starts a correction run in
  Edit mode scoped to the disputed target, with the rejected change and the
  reason in context. Its new change carries `supersedes`, and the rejected
  change becomes `superseded`. Accepted changes are never touched by a
  correction. Rounds repeat without limit.

### 7.5 Recovery and retries (R-C5)

On service start, the service runs the steps below for every journal whose
phase is not `applied`, and for every change in `rejecting`. It does this
before serving any write. Each file write is atomic, so a file always holds
either its old content or its new content, never a mixture. A multi-file run
can still stop part-way through, with some files written and others not.

- **Interrupted apply:** for each file that is `planned`, compare the
  current hash with the hashes saved in the journal.
  - If it equals `afterHash`, the write landed but the journal update did
    not. Mark the file `written` and its changes `pending`.
  - If it equals `beforeHash`, the write never happened. Recompute the
    content from the current file and the saved changes, check that the
    result hashes to `afterHash`, write it, and mark the file `written`.
    This rolls the run forward, because the user asked for the edit.
  - Anything else means the file changed outside Nexus in between. Mark the
    file and its changes `conflicted` with `reason: changed-before-apply`,
    and write nothing.
- **Interrupted rejection:** for each change in `rejecting`, compare the
  current hash with `reversal.afterHash` and `reversal.beforeHash`.
  - If it equals `afterHash`, mark the change `rejected`.
  - If it equals `beforeHash`, redo the reversal (section 7.4, step 2).
  - Anything else is `conflicted`.
- `pending` and `conflicted` changes are restored to the review bar.
- **Idempotence:** Accept, Reject and apply are all idempotent. A request
  that finds its change already in the target state returns success without
  writing, so a client can safely retry by sending the same change ID. A
  repeated proposal with a known `opId` returns the existing change.

### 7.6 Atomic writes

Write to `<file>.nexus-tmp-<random>` in the same folder, flush and `fsync`,
then rename over the target (on Windows, retry briefly if the file is
transiently locked by an editor or antivirus). For `.nexus/*.json`, keep the
previous good version as `<file>.bak`. The watcher ignores events for hashes
the service itself just wrote, so its own writes are not mistaken for
external edits.

### 7.7 Reminders and pending data (D-C3)

The scheduler computes reminders from **effective accepted values**: for any
field with a pending or conflicted change, it uses the change's `before`
value; pending new records are ignored. The calendar shows a proposed date
with a "Proposed" marker. Accepting a date change triggers rescheduling.

## 8. Scheduler and notifications

- Runs in the service while it is running. Every 30 s, and on any data
  change, it computes due reminders for the next 24 h from accepted data.
- **Deduplication key**: `targetKind:targetId:ruleId:scheduledInstantUTC`.
  Before delivering, the scheduler writes the key to
  `state/deliveries.json` with status `delivering`, then emits the
  notification, then marks it `delivered`. A key that already exists is never
  delivered again, so each reminder is delivered at most once (DEC-009).
- **Missed reminders**: on start, any reminder whose instant passed while the
  app was closed, or that was left `delivering`, is shown once in a "While you
  were away" summary in Notifications and then recorded as delivered.
- **Personalised wording** (opt-in): up to 15 minutes before the instant, the
  scheduler asks the coordinator for wording, using only the target and its
  linked note section, with a 10 s timeout. The result is plain text, capped
  at 200 characters, and stored with the delivery. If it is not ready at the
  instant, the ordinary text is used. Wording never changes the time or the
  target.
- **Test reminder**: `POST /reminders/test` delivers immediately with the
  title "Test reminder", targeting the first issue or the Notifications page.
- **Surfaces**: SSE → in-app toast and list (browser and Electron); Electron
  main also shows a native notification if permission is granted. One
  delivery record, two surfaces.

## 9. Coordinator

- **Modes**: the composer's Ask/Edit switch sets the run's authority. Ask
  runs never receive `propose_changes`. Edit runs may propose changes
  limited to the open workspace. If an Ask answer includes suggestions, the
  UI offers "Make these changes", which starts a new Edit run (DEC-008).
- **Loop**: system prompt plus history, then a provider call with tools,
  then each tool call is validated and executed, and results are returned as
  data. The loop stops on `final_answer` or at the limits: 8 steps per run, 2
  provider retries with backoff that honours `Retry-After`, a 60 s
  per-request timeout and a 3-minute run budget. The model is pinned at run
  start and recorded in the run.
- **Capability probe** (Settings → Test): a minimal tool-call request and a
  minimal JSON-schema request. Results are stored per profile as
  `{ toolCalling, structuredOutput, testedAt }`. Edit mode requires
  tool calling.
- **Fallback for weak models**: if a profile lacks tool calling but supports
  structured output, Ask runs use retrieval-first mode. Nexus runs search and
  issue queries itself from the question, supplies the results, and asks for
  `final_answer` JSON. If it supports neither, AI is disabled for that
  profile, with an explanation.
- **Grounding**: every source in a tool result has a handle (`S1`, `S2` and so
  on) mapped to `note:<path>#<slug>` or `issue:<key>`. The service rejects
  citations to handles not retrieved in the run. A claim that is left with no
  sources is shown as a suggestion, never as a fact. Discrepancies are
  rendered with both sources.
- **Injection**: tool results are wrapped as quoted data, and the system
  prompt states that workspace text is content, not instructions. The
  enforcement does not rely on the prompt: authority comes from the mode, the
  tool set and server-side validation, and the agent cannot accept changes
  (R-A6, PRD-055).

## 10. Failure behaviour

| Failure | Behaviour |
| --- | --- |
| No provider, key or network | AI controls show "AI is off" or "Offline". Every manual feature works. Reminders use ordinary text |
| Provider 401/403 | "Key rejected by *provider*". Link to Settings. No retry |
| Provider 429 or timeout | Retry up to 2 times with backoff, then "Rate limited, try again in *n* s" or "Provider timed out". Partial answers are discarded |
| Invalid tool arguments | Returned to the model as a validation error, then counted against the step limit. Nothing is written |
| Workspace folder missing or unreadable | Welcome screen with "Workspace not found". Choose another folder |
| Lock held by a live instance | Second instance refuses to open the workspace and links to the running instance. A stale lock (dead pid) is taken over |
| JSON file fails to parse or validate | That collection opens read-only with an error and a "Restore from .bak" action. Other collections work |
| Manual write fails (disk full, permission) | The save fails with a clear error. The file keeps its previous content (atomic write), and the editor keeps the unsaved buffer |
| A file write fails during a multi-file agent apply | Files already written stay `pending` for review. The failed file is marked `failed` and the run `partial`. The user can Retry or Discard the rest (7.3) |
| Crash or power loss during apply or rejection | On restart, each file is checked against the journal's saved hashes and rolled forward, or marked `conflicted` (7.5) |
| External edit overlaps a reversal | `conflicted`, newer work kept (7.4) |
| External edit while the user has unsaved changes | Banner offering Keep mine, Load disk or Compare. Nothing is discarded silently |
| Notification permission denied | In-app notifications only, with a Settings hint |
| Clock or time-zone change | Instants recomputed. The dedup key prevents double delivery |
| Unknown `schemaVersion` (newer) | Open read-only with "Created by a newer Nexus" |

## 11. Security summary

- The service listens on loopback only and checks the `Host` header. It
  sends no CORS headers. Single-use launch codes travel in the URL fragment,
  and session tokens travel only in request bodies and headers, never in
  query strings or logs (4.1).
- Sandboxed Electron renderer with a minimal preload API (4.2).
- Keys are kept only in safeStorage or service memory, are redacted from
  logs and errors, and are excluded from the workspace and the package
  (PRD-076). A secret-scan test runs over the workspace, logs and the built
  package.
- Rendered Markdown is sanitised. Note HTML is never executed.
- Paths are validated against the workspace root on every operation.
- The agent's authority is enforced in code (section 9).
