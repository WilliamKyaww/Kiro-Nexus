# Requirements: backlinks and wikilink completion (B2)

## Introduction

Notes link to each other with `[[wikilinks]]`, and the preview already follows them. This
increment adds the two missing halves of PRD-021: a **Backlinks** panel that lists the notes
linking to the open note, with the passage around each link, and keyboard **`[[`
completion** in the editor for note names and headings. Both work with AI off.

Will authorised this as stage 4 of overnight run 6 (`.tmp/2026-11-25-kiro-overnight.md`),
limited to backlinks and completion. The graph view, CodeMirror and link repair on rename
stay out of scope.

- **Traces to:** PRD-020 and PRD-021; architecture 6 (wikilinks resolve by case-insensitive
  file name, preferring the closest path) and 4.1 (`GET /notes/{path}/backlinks`); DEC-006.
- **Approval:** written and self-reviewed by Kiro under Will's authorisation (run 6). Human
  review is pending.

## Glossary

- **Target:** the note part of a link, `Name` in `[[Name#Heading|alias]]`.
- **Backlink:** a link in another note (or this one) whose target resolves to this note.
- **Ambiguous name:** a target that matches more than one note equally well.

## Requirements

### Requirement 1: One rule for resolving a link

1. A target SHALL resolve to the note whose path, without `.md`, equals it
   case-insensitively; otherwise to the note whose file name equals it.
2. WHEN several notes have that file name, THEN the one closest to the linking note SHALL be
   chosen: the most shared folders first, then the fewest folders. WHEN two or more are
   equally close, the link SHALL be **ambiguous**, and Nexus SHALL name the candidates rather
   than pick one.
3. The preview, the backlinks and the completion SHALL use this same rule. Links inside code
   blocks and inline code SHALL be ignored, as the preview ignores them.

### Requirement 2: The Backlinks panel

1. The note page SHALL list every link that resolves to the open note, grouped by source
   note, each with the source's name, the section it is in, and its line as plain text.
2. Selecting a backlink SHALL open the source note at that passage, scrolled into view,
   focused and marked.
3. A link whose heading does not exist in this note SHALL be listed with "heading not
   found", naming the heading it asks for.
4. An ambiguous link SHALL be listed on each candidate's panel, saying which notes share the
   name. The preview SHALL mark it as ambiguous and not follow it.
5. The panel SHALL update within 2 s of a change by Nexus or outside it, and SHALL be the
   same after a restart. It SHALL show only the open workspace's notes.

### Requirement 3: `[[` completion

1. WHEN the user types `[[` in the editor, THEN Nexus SHALL suggest notes, narrowed by what
   follows. After `#`, it SHALL suggest the headings of the named note. After `|`, it SHALL
   suggest nothing: the alias is free text.
2. Arrow keys SHALL move through the suggestions, Enter or Tab SHALL insert the current one,
   and Escape SHALL dismiss the list without changing the text. It SHALL follow the
   combobox pattern, so assistive technology announces the list and the current option.
3. Inserting SHALL replace only the part being completed. The rest of the link (heading,
   alias, closing `]]`) and the text around it SHALL be kept. An unclosed link SHALL be
   closed. The caret SHALL end after the inserted text, and Undo SHALL restore the typing.
4. WHEN two notes share a file name, THEN the suggestions SHALL show their folders, and the
   inserted target SHALL be the path, so the link is not ambiguous.
5. WHEN the named note does not exist, is ambiguous, or has no matching heading, THEN the
   list SHALL say so instead of offering a guess.
6. Completion SHALL change only the editor's text. The draft stays unsaved until the user
   saves, and survives navigation like any other edit.

### Requirement 4: Evidence

1. Unit tests SHALL cover resolution (including duplicate names), link parsing outside code,
   the backlink index, and the completion's token and insertion logic.
2. A browser test SHALL cover, with AI off and in two fictional workspaces: the panel and its
   navigation, an outside edit, a missing heading, duplicate names, completion by keyboard
   with an alias kept, Escape, an unsaved draft, and a restart.
