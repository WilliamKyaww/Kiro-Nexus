# Nexus PRD: architecture

- **Status:** Complete draft for Will's review
- **Last updated:** 2026-11-24
- **Traces to:** `structure.md` (PRD-xxx); intake R-*/D-*; decisions
  DEC-005 to DEC-010.

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

npm workspaces monorepo:

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

- Bound to `127.0.0.1` on a free port. Every request needs
  `Authorization: Bearer <session token>`; the token is random per service
  start. The service rejects requests whose `Host` is not the loopback
  address and port, and serves no CORS headers, so other web pages cannot
  call it.
- The service serves the built UI from the same origin. It opens or prints
  `http://127.0.0.1:<port>/#token=<token>`; the UI moves the token into
  `sessionStorage` and clears the fragment.
- All bodies are validated against `packages/schema` (Zod). Errors use
  `{ error: { code, message, details? } }` with stable codes (e.g.
  `REVISION_MISMATCH`, `LOCKED`, `PROVIDER_RATE_LIMITED`).

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

Main subscribes to the service's SSE `notification` events and shows native
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

```json
{
  "runId": "run_01J...", "conversationId": "cnv_01J...",
  "model": { "profileId": "prf_...", "model": "pinned-model-id" },
  "createdAt": "...", "phase": "prepared | applied",
  "changes": [
    {
      "changeId": "chg_01J...",
      "kind": "note.replaceBlock | note.insertBlock | note.deleteBlock | note.create | record.create | record.updateField | record.delete | link.add | link.remove",
      "target": { "file": ".nexus/issues.json", "recordId": "iss_...", "field": "due" },
      "baseRevision": 3,
      "before": { "value": { "date": "2026-12-05" } },
      "after":  { "value": { "date": "2026-12-03" } },
      "anchor": null,
      "dependsOn": [],
      "supersedes": null,
      "state": "prepared",
      "history": [{ "state": "prepared", "at": "...", "by": "agent" }]
    }
  ]
}
```

For note changes, `target.file` is the note path, `baseRevision` is the file
hash, `anchor` is `{ headingSlug, blockIndex }`, and `before`/`after` hold the
exact block text (empty for insertions or deletions respectively).

### 7.3 Apply sequence (R-C1, R-C2)

1. **Validate** every operation: schema, path inside the workspace (resolved,
   no `..`, no symlink escape, `.md` or known `.nexus/*.json` only), target
   exists (or does not, for creates), base revision equals current, and
   `before` matches current content. Invalid operations are returned to the
   model with a reason; the model may retry within the step limit. Nothing is
   written for an invalid operation.
2. **Journal**: write `reviews/<runId>.json` with all valid changes in state
   `prepared` (atomic write, section 7.6).
3. **Apply per file**: compute each file's new content from all of its
   changes; write it atomically; then update the journal entries for that
   file to `pending`. Mark the run `applied` when all files are done.
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
- **Reject** `pending → rejected` with reversal:
  1. Locate the change's current region: for a field, the field's current
     value; for a note block, the unique occurrence of the `after` text within
     its anchored section (falling back to the whole file); for a created
     record or note, the whole item.
  2. If the current region equals `after`, write `before` back atomically
     (other content in the file, including other changes, is untouched).
  3. Otherwise mark the change `conflicted` and show before, proposed and
     current side by side. The default action is **Keep current** (closes as
     rejected, no write). **Restore original** overwrites only after explicit
     confirmation and stores the overwritten text in the journal.
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

On service start, before serving writes:

- For each journal with changes in `prepared`: if the file's hash equals the
  expected post-apply hash, mark `pending`; if it equals the base, re-apply
  (roll forward, because the user requested the edit); otherwise mark
  `conflicted`. Each file write is atomic, so the file is in exactly one of
  these states.
- `pending` and `conflicted` changes are restored to the review bar.
- Accept, reject and apply are idempotent: repeating an operation that
  already reached its target state returns success without writing. Each
  request carries the change ID, so client retries are safe.

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
| Write fails (disk full, permission) | Operation fails with a clear error. Journal state is unchanged, so there is no partial change |
| Crash during an agent apply | Recovery as in 7.5 |
| External edit overlaps a reversal | `conflicted`, newer work kept (7.4) |
| External edit while the user has unsaved changes | Banner offering Keep mine, Load disk or Compare. Nothing is discarded silently |
| Notification permission denied | In-app notifications only, with a Settings hint |
| Clock or time-zone change | Instants recomputed. The dedup key prevents double delivery |
| Unknown `schemaVersion` (newer) | Open read-only with "Created by a newer Nexus" |

## 11. Security summary

- Loopback-only service with a per-start bearer token, host-header check and
  no CORS (4.1).
- Sandboxed Electron renderer with a minimal preload API (4.2).
- Keys are kept only in safeStorage or service memory, are redacted from
  logs and errors, and are excluded from the workspace and the package
  (PRD-076). A secret-scan test runs over the workspace, logs and the built
  package.
- Rendered Markdown is sanitised. Note HTML is never executed.
- Paths are validated against the workspace root on every operation.
- The agent's authority is enforced in code (section 9).
