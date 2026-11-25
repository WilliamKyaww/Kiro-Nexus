# Design: backlinks and wikilink completion

## Shared rule (`packages/markdown/src/links.ts`)

- `linksIn(markdown)`: every `[[…]]` outside fenced code and inline code, with its target,
  heading, alias, zero-based line and the line's text.
- `resolveNoteTarget(target, notes, from)`: `{ status: "ok", path }`, `{ status: "missing" }`
  or `{ status: "ambiguous", candidates }`, by Requirement 1. Closeness to `from` is the
  number of leading folders shared, then the fewest folders.
- `noteTargetFor(path, notes)`: the file name when no other note shares it, otherwise the
  path, both without `.md`. Completion inserts this.
- `linkDisplay(line)`: the line with each link replaced by what the preview shows (the alias,
  or `Name › Heading`, or `Name`), for the backlink context.

## Service

- `GET /api/v1/notes/backlinks?path=<note>` (the API's query form of
  `/notes/{path}/backlinks`) returns `{ backlinks: BacklinkView[] }`:
  `{ source, line, context, sectionSlug, sectionText, heading, headingStatus, headingSlug,
  alias, candidates }`.
- It reads every note through `WorkspaceService` when asked. The workspaces are small, and
  reading on demand means an outside edit, a Nexus save, a restart and a workspace switch
  need no cache to stay right.
- `headingStatus` is `none` (no heading in the link), `ok` (by `resolveHeading`: the slug,
  then a unique heading with the same text) or `missing`.
- `candidates` lists every note an ambiguous link could mean. Such a link is returned for
  each of them.

## UI

- **Panel.** A "Backlinks" section in the note's side panel, after Linked issues. Each item
  links to `/notes?path=<source>&line=<n>` and shows the source name, its section, and the
  context line. Markers: "heading not found: <heading>" and "ambiguous: also <other notes>".
  The query key is `["backlinks", path]`, invalidated by every note `file.changed` event and
  by a save.
- **Passage.** `line` makes the preview mark the paragraph, list item or heading that holds
  that source line (`line-target`). It is scrolled into view above the review bar, focused
  and flashed once, like a change.
- **Preview.** It uses `resolveNoteTarget` with the open note's path. An ambiguous link is
  rendered as text with "Ambiguous link" and the candidates in its title, not as a link.
- **Completion** (`apps/web/src/notes/WikilinkEditor.tsx`, logic in `wikilinks.ts`).
  - The textarea is a combobox: `aria-autocomplete="list"`, `aria-expanded`,
    `aria-controls` and `aria-activedescendant` while the list is open.
  - The list is placed at the caret, measured with a mirror element, and kept inside the
    editor.
  - `linkAt(text, caret)` finds the open `[[` on the caret's line, the part being edited
    (target, heading or alias) and the extent of any existing `]]`.
  - Notes are ranked by name prefix, then name contains, then path contains, up to 8.
    Headings come from the named note's `NoteView`, fetched on demand.
  - Insertion selects the replaced range and uses `execCommand("insertText")`, which keeps
    the browser's undo and fires the normal input event, so the draft store records it. If
    that is unavailable it falls back to `setRangeText`.
  - Escape closes the list until the caret leaves that link or another `[` is typed.

## Testing

- `packages/markdown/src/links.test.ts`: resolution, closeness, ambiguity, `noteTargetFor`,
  code is skipped, lines and parts.
- `apps/web/src/notes/wikilinks.test.ts`: `linkAt` for each part, closed and unclosed links,
  suggestions and insertion that keeps the alias.
- `server/src/notes/backlinks.test.ts`: backlinks with sections and context, a missing
  heading, an ambiguous name, links in code ignored.
- `tests/e2e/b2-backlinks.spec.ts` (Edge, AI off): Requirement 4.2.
