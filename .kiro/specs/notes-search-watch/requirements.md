# Requirements: B2 notes slice (heading-level search and external changes)

## Introduction

This is the first part of B2. It covers search results at the level of a
note section, and edits made to notes in another editor while Nexus is open.
Renaming, moving and deleting notes from the UI, CodeMirror and backlinks
remain in B2 and are listed in `BACKLOG.md`.

- **Traces to:** PRD-022, PRD-023, PRD-054, R-N1, R-N3 and R-A5.
- **Approval:** written and self-reviewed by Kiro under Will's overnight
  authorisation of 24 November 2026. Human review is pending.

## Requirements

### Requirement 1: Section-level search (PRD-022)

**User story:** As a user, I want to search my notes and land on the
heading where the match is.

1. WHEN the user searches THEN results SHALL be note sections. A section is
   a heading plus its text up to the next heading, or the text before the
   first heading. Each result shows the note, its heading path and a snippet.
2. Matches in headings SHALL rank above matches in body text. Prefix and
   small typos SHALL still match.
3. WHEN the user opens a result THEN the note SHALL open scrolled to that
   heading.
4. The index SHALL live only in memory. It SHALL be rebuilt from the
   Markdown files when the workspace opens, and updated after every save
   made in Nexus and every external change (PRD-054).

### Requirement 2: External changes (PRD-023, R-N3)

**User story:** As a user who also edits notes in another editor, I want
Nexus to notice and never throw away what I have typed.

1. WHEN a note changes on disk outside Nexus THEN the service SHALL detect
   it within 2 seconds and publish `file.changed` with `source: external`.
   Its own writes SHALL NOT be reported as external.
2. IF the open note has no unsaved edits THEN the view SHALL reload in place.
3. IF the open note has unsaved edits THEN the editor SHALL keep them and
   show "changed outside the editor". The user SHALL be able to load the new
   version, or compare and then overwrite with their own text.
4. IF the open note is deleted outside Nexus while it has unsaved edits THEN
   the editor SHALL keep the text and offer to recreate the note with it.
5. WHEN `.nexus/issues.json` or `projects.json` changes outside Nexus THEN
   the service SHALL reload it, if it is valid, and publish the change.
6. Pending review markers SHALL follow the note's new content.
