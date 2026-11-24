# Design: B2 search and external changes

- **Review:** Kiro self-review only.

## Components

| Module | Responsibility |
| --- | --- |
| `packages/markdown` `sections(md)` | Splits a note into sections: `{ headingSlug, headingText, headingPath[], startLine, text }`. The preamble has `headingSlug: null` |
| `server/src/notes/search.ts` `SearchIndex` | Builds a MiniSearch index over `{ title, heading, text }`, with boosts of heading 3 and title 2, `prefix` and `fuzzy: 0.2`. Each note keeps a list of its section IDs so the note can be reindexed. Snippets are taken around the first matched term |
| `server/src/notes/watcher.ts` | Runs a chokidar watcher on the workspace root. It ignores dot-folders except `.nexus/issues.json` and `projects.json`, uses `awaitWriteFinish` (150 ms) and `ignoreInitial`. Each event calls the service |
| `WorkspaceService.externalNoteChanged(rel)` | Reads the note and compares its hash with the last hash Nexus wrote or reported. Only a different hash is published as `source: external`, and a missing file is published with `revision: null`. Nexus's own writes record their hash first, so the watcher's echo is ignored |
| `WorkspaceService.externalCollectionChanged(name)` | Reloads and publishes the collection when its hash differs from the cached one and the file is valid. If it is invalid, the service logs it and keeps the cache. The next write is refused, so the invalid file is never overwritten |
| `GET /api/v1/search?q=` | Returns `{ results: [{ path, headingSlug, headingText, headingPath, snippet, score }] }`, at most 20 |
| UI | A search box at the top of the Notes sidebar, with results linking to `/notes?path=…&heading=…`. The note editor keeps the B1 banner logic and adds a "deleted outside the editor" state. Review queries refresh on `file.changed` |

## Self-review (Kiro)

- **Echo suppression** uses content hashes, not timestamps. A rename made
  by `atomicWrite` produces one `change` event whose hash equals Nexus's own
  write, so it is ignored.
- **Edits that arrive together** are handled one at a time. Two quick
  external edits within the `awaitWriteFinish` window produce a single event
  for the final content. That is acceptable, because the user sees the
  latest version.
