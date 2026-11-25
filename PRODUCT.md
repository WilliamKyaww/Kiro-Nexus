# Product

<!-- impeccable:product-schema 1 -->

Confirmed by Will on 25 November 2026 as the working record. Will and Hein
may revise it later. The authoritative requirements stay in
`docs/PRD/structure.md`.

## Platform

web

Nexus is a web app, with an Electron wrapper for the desktop. The wrapper
does not change the design language.

## Users

- **Student project teams of two to five people.** They meet, write notes,
  and then have to turn what they agreed into tracked work.
- **Small-team leads and solo makers.** They want plain files they own and
  a light board, not an enterprise tracker.
- **Hackathon judges.** They try Nexus for a few minutes, for free, and
  check the AI claims themselves.

Large organisations that need permissions, sprints, reports or multi-user
sync are not users of the first release.

## Product Purpose

Nexus turns meeting notes into tracked issues without the user keeping two
tools in step by hand. It answers the question "What did we agree, what is
already on the board, and what still needs doing?" Success means the user
can follow one agreement from a sentence in a note to a field on an issue,
and correct either side with confidence.

## Positioning

One local folder holds both the Markdown notes and the project board. Every
journey works with AI off. The optional agent answers with citations that
open the exact heading or issue, and proposes edits as tentative changes to
the real files. The user accepts or rejects each change on the page where
it applies. Kiroween 2026 entry, Frankenstein category: an Obsidian-style
notebook stitched to a Jira-style board, with an agent over both.

## Operating Context

- A meeting happens; someone writes a note with Decisions and Actions
  headings, then links the actions to issues.
- The team runs a three-column board (To do, In progress, Done) with
  priorities and due dates, and a month calendar of dated issues and
  events.
- The user asks Nexus what is outstanding, then asks it to fix the gaps,
  and steps through each proposed change with a review bar.
- Reminders fire at the right local time, in the browser or as native
  desktop notifications.
- Judges follow written instructions on a fictional sample workspace.

## Capabilities and Constraints

- Sections: Home (Ask and Edit), Notes, Projects (board, backlog, issue),
  Calendar, Notifications and Settings.
- Notes are ordinary `.md` files. Structured data is versioned JSON with
  stable IDs.
- One writer per workspace. No multi-user sync.
- AI uses OpenAI-compatible provider profiles. Keys never reach the
  workspace, the renderer, logs or builds.
- Terminology: *note*, *heading*, *issue* (with keys such as `NEX-1`),
  *board*, *change* (a tentative agent edit), *Accept* and *Reject*,
  *Ask* and *Edit* modes.
- British English in all UI copy.
- Undecided: the judge AI route (Q5) and the open-source licence.

## Brand Commitments

- The name is Nexus.
- Nexus has an original visual identity. It borrows behaviours from other
  products, never their branding.
- No final identity exists yet. Any visual direction is a proposal for Will
  first, then Hein, and can change until both agree.
- Craft bar (Will, 25 November 2026): Nexus should sit alongside Linear for
  the board and issues, Notion or Obsidian for notes, and Temporal for the
  calendar and the overall layout. Behaviours only, never their branding.

## Evidence on Hand

- A fictional sample workspace, `samples/meeting-workspace/`: the kickoff
  note `meetings/2026-11-24 kickoff.md` and project `NEX` with `NEX-1`
  "Build calendar view".
- No real users, testimonials, customers or metrics. Do not invent them.

## Product Principles

1. Useful with AI off.
2. Files the user owns.
3. The agent proposes and the user decides.
4. Grounded or silent: answers cite real sources and say when evidence is
   missing.
5. Original identity.

## Accessibility & Inclusion

- Keyboard operation and visible focus throughout, including review
  (PRD-080).
- Reduced motion replaces the change highlight with a static outline.
- Works at a 390 px width.
- Status changes on the board work by keyboard as well as by drag
  (PRD-031).
