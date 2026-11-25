# Nexus workspace data format (schema version 1)

A Nexus workspace is an ordinary folder. Everything in it can be read
without Nexus. The authoritative schemas are the Zod definitions in
`packages/schema/src/index.ts`.

```
<workspace>/
  **/*.md                 your notes (plain Markdown, never annotated by Nexus)
  .nexus/
    workspace.json        identity and time zone
    projects.json         projects
    issues.json           issues (tasks)
    *.json.bak            previous good copy, written before each change
    reviews/<runId>.json  change-review journal (B5)
    lock                  single-writer lock while Nexus has the workspace open
```

## General rules

- **IDs** are a type prefix plus a ULID, for example
  `iss_01KAR5Y3S2M8Q4K7Y2C9X5V6B3`. An ID is never reused. Issue keys such
  as `NEX-1` are stable and readable by people.
- **Timestamps** are UTC ISO 8601 strings.
- **Serialisation** is deterministic. Keys appear in schema order, with
  two-space indentation and a trailing LF, so the same data always gives the
  same bytes and the same hash.
- **Revisions:**
  - Each record has an integer `revision` that increases on every write.
  - A note's revision is `sha256:<hex>` of its exact bytes.
  - An edit must supply the revision it started from. If that revision is
    out of date, Nexus writes nothing and reports a conflict.
- **Writes** are atomic. Nexus writes a hidden temporary file in the same
  folder, flushes it to disk and renames it over the target.
- **External edits to JSON:** if a `.nexus/*.json` file changed on disk
  since Nexus last read it, Nexus reloads it and refuses the pending write.
  Nexus never overwrites newer data that it has not read.
- **Validation failure:** an invalid or unparseable file is reported by name
  and never overwritten. A file whose `schemaVersion` is newer than Nexus
  supports is also refused.

## `workspace.json`

```json
{ "schemaVersion": 1, "workspaceId": "wsp_…", "name": "Kickoff sample (fictional)",
  "timeZone": "Europe/London", "createdAt": "2026-11-24T09:00:00.000Z" }
```

## `projects.json`

```json
{ "schemaVersion": 1, "projects": [
  { "id": "prj_…", "key": "NEX", "name": "Nexus hackathon", "nextIssueNumber": 2,
    "createdAt": "…", "updatedAt": "…", "revision": 1 } ] }
```

`key` is 2 to 10 capital letters or digits and starts with a letter. The
next issue number is the larger of `nextIssueNumber` and one more than the
highest number already used. A crash between writing `issues.json` and
writing `projects.json` therefore cannot cause a key to be reused.

## `issues.json`

```json
{ "schemaVersion": 1, "issues": [
  { "id": "iss_…", "key": "NEX-1", "projectId": "prj_…", "title": "Build calendar view",
    "description": "Markdown text", "status": "in_progress", "priority": "high",
    "due": { "date": "2026-12-05" }, "rank": "00000001",
    "noteLinks": [{ "notePath": "meetings/2026-11-24 kickoff.md", "headingSlug": "actions", "headingText": "Actions" }],
    "createdAt": "…", "updatedAt": "…", "revision": 1 } ] }
```

| Field | Values |
| --- | --- |
| `status` | `todo`, `in_progress`, `done` |
| `priority` | `low`, `medium`, `high`, `urgent` |
| `due` | `null`; `{ "date": "YYYY-MM-DD" }` for an all-day date, read in the workspace time zone; or `{ "dateTime": "<UTC ISO>", "timeZone": "<IANA>" }` |
| `rank` | Orders issues within a column. In B1 it is a zero-padded number. Slice B3 may switch to fractional indexing |
| `noteLinks` | Links from the issue to notes, described below |

### Note links (DEC-006)

Each entry in `noteLinks` stores three values, and Nexus writes nothing into
the note itself:

| Field | Meaning |
| --- | --- |
| `notePath` | The note's path relative to the workspace, with forward slashes |
| `headingSlug` | GitHub-style slug of the heading, or `null` to link the whole note |
| `headingText` | The heading's plain text, or `null` |

Nexus resolves a link in this order:

1. The exact slug.
2. Otherwise, a heading with the same text, if exactly one exists.
3. Otherwise, the note opens with a "heading not found" message.

Slugs come from ATX headings (`#` to `######`) outside fenced code blocks.
When a heading text repeats, the copies get de-duplicated slugs such as
`actions` and `actions-1`. Setext headings (text underlined with `===` or
`---`) are not yet recognised.

## Notes

- A note is any `.md` file under the workspace, except those in folders or
  files whose names start with a dot.
- Nexus saves the exact text from the editor. One exception: if a file uses
  CRLF line endings and the editor sends LF only, Nexus keeps CRLF, because
  browser text areas normalise line endings.
- `[[Note]]`, `[[Note#Heading]]` and `[[Note|alias]]` resolve by file name,
  case-insensitively, preferring the shallowest path. A known issue key such
  as `NEX-1` in text renders as a link to that issue.

## Drafts and saving (actual behaviour)

- **Drafts are not workspace data.** Unsaved text lives in the browser tab,
  in its session storage, keyed by workspace ID and note path. It survives
  page navigation, Back, automatic review jumps and a reload of that tab. It
  is lost when the tab or desktop window is closed, and Nexus warns before
  that happens.
- **The editing base.** A draft records the note revision at the moment
  the first character was typed. A save sends that base. If the file has
  changed since, the save writes nothing. Nexus then shows the actual disk
  text next to the draft, and the user chooses "Load latest" or
  "Overwrite with mine".
- **In-flight saves.** When a save succeeds, only the exact text that was
  submitted is cleared. Text typed while the save was in flight stays as a
  draft, now based on the saved revision, and the status reads "Unsaved
  changes" rather than "Saved".
- **Outside edits while a draft is open** keep the draft and say so.
  "Compare and choose" shows both texts before anything is written.
- **Outside deletion while a draft is open** keeps the draft and offers
  "Recreate with my text".

## Reminders (B4)

Schemas: `packages/schema/src/reminders.ts`. Spec: `.kiro/specs/reminders/`.

### `reminders.json` (user data)

```json
{ "schemaVersion": 1, "enabled": true, "allDayTime": "09:00", "timedOffsetMinutes": 60, "nativeNotifications": true }
```

- Created when reminder settings are first saved. Without it, the defaults
  shown apply.
- `allDayTime` is the local time, in the workspace zone, at which an all-day
  due date reminds.
- `timedOffsetMinutes` is how long before a timed due date, or a timed event
  start, the reminder fires.
- `nativeNotifications` is used by the desktop app only.

### `calendar.json` (shared event record)

```json
{ "schemaVersion": 1, "events": [
  { "id": "evt_…", "title": "Demo rehearsal", "start": { "dateTime": "2026-12-02T15:00:00Z", "timeZone": "Europe/London" }, "end": null, "reminder": true }
] }
```

- Hein's calendar slice creates and edits events. Reminders only read this
  file.
- `start` and `end` use the same shape as an issue's `due`. Their `timeZone`
  must be an IANA zone the runtime recognises (since run 6, R5-4).
- Event `id`s are unique in the file (since run 6, R5-6).
- `reminder: false` turns off that event's reminder.
- A missing file means there are no events. Rows are checked one at a time: a
  row that is not valid, or that repeats an `id`, is skipped and listed under
  "Some items have no reminder" in Notifications, with its file and record.
  Other reminders are not affected. An empty file is reported in the same way.
- The scheduler reads it again on every tick, at least every 30 seconds.

### `state/deliveries.json` (service state, not user data)

One record per reminder occurrence, shared by every surface (DEC-009):

```json
{ "schemaVersion": 1, "seenUpTo": "2026-12-05T09:00:30.000Z", "deliveries": [
  { "id": "dlv_…", "key": "issue:iss_…:allday-0900:2026-12-05T09:00:00.000Z", "kind": "issue",
    "targetId": "iss_…", "targetKey": "NEX-1", "title": "Build calendar view", "detail": "Due today",
    "workspaceId": "wsp_…", "rule": "allday-0900", "scheduledAt": "2026-12-05T09:00:00.000Z",
    "status": "delivered", "deliveredAt": "2026-12-05T09:00:30.000Z", "batch": null }
] }
```

- `key` is the target, the rule and the scheduled instant. A key that is
  already in the log is never delivered again.
- `status`:
  - `delivering` is written before a reminder is shown;
  - `delivered` is written after;
  - `missed` means it came due while Nexus was closed, or a crash left it at
    `delivering`.
- `batch` names the start-up that recorded a missed reminder. "While you were
  away" shows only the current start-up's batch.
- `seenUpTo` drives the unseen count on the rail.
- Old entries are pruned beyond the newest 500, but only once they are more
  than 60 days past. `prunedUpTo` (since run 6) is the latest scheduled
  instant pruned: nothing at or before it is delivered or recorded again,
  even if the clock is set back (R5-6).
- Only a missing file means first use. An empty file, a file that is not
  valid JSON or not in this format, or one that cannot be read is damaged
  (R5-5):
  - Nexus delivers no reminders and leaves the file as it is;
  - Notifications names the file and offers **Start a new delivery log**
    (`POST /api/v1/reminders/delivery-log/replace`). It first keeps a copy
    as `deliveries.damaged-<instant>.json` beside it, and the new log's
    `prunedUpTo` is the moment of the replacement, so nothing that came due
    earlier is delivered or listed again;
  - after a repair by hand, reminders resume at the next tick, without
    reopening the workspace.

### `state/scheduler.json` (service state)

`{ "schemaVersion": 1, "lastTickAt": "…" }` records the end of the last
period in which Nexus was delivering reminders. Occurrences between it and
the next start count as missed.

## `lock`

`lock` holds `{ pid, instanceId, port, startedAt }`.

- It is created exclusively when Nexus opens the workspace and removed when
  Nexus shuts down cleanly.
- A second Nexus refuses to open the workspace while the holder's process is
  alive.
- A lock left by a process that is no longer running is taken over, and the
  takeover is logged.
- If another program happens to reuse the old pid, Nexus refuses to open the
  workspace and tells you which file to delete.
