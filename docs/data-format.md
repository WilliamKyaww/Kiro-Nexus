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
