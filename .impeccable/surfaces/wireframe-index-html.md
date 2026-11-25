---
version: 1
slug: "wireframe-index-html"
primary_target: "wireframe/index.html"
related_targets: ["wireframe/wireframe.css","wireframe/wireframe.js"]
---

## Scope

The Nexus wireframe prototype in `wireframe/` (`index.html`, `wireframe.css`, `wireframe.js`). Visitor mode: Operate. It is a design proposal for Will first, then Hein. If they adopt it, the main app follows it.

## Audience and task

Will and Hein are judging a look for the real app, and hackathon judges may see it in the demo. Each view must show its working job with fictional data: Home with an Ask answer and citations, a note with internal links and a review bar, a graph of notes and issues, a three-column board, an issue, a month calendar, Notifications and Settings. The fixed review demo must still work: two changes, Accept, Reject with feedback, and Previous and Next across pages.

## Constraints

- Pure HTML, CSS and JS with hardcoded fictional data. No build step and no dependencies.
- Only `wireframe/` changes. The app in `apps/`, `server/` and `packages/` is untouched.
- `npm run mcp:smoke` must keep passing: the "Apply fixed demo changes" button, "AI is off", "Wireframe prototype" in an accessible name, "Kickoff, 24 November", "NEX-1 Build calendar view", "3 Dec 2026" and "5 Dec 2026", and "What was wrong".
- One small dot indicator explains that the data is fictional, on hover, focus or tap. No repeated "fictional" or "not AI" labels.
- Keyboard use, visible focus, reduced motion and a 390 px width throughout. British English.

## Quality bar

The category standard, chosen by Will on 25 November 2026. Match the craft of Linear for the board and issues, Notion or Obsidian for notes (including internal links and a graph view), and Temporal for the calendar and the overall shell. Borrow behaviours only, never their branding.

## Direction contract

THESIS: Nexus looks like a calm, well-made workspace, where a note and an issue sit one click apart and every agent change waits visibly for a decision. It refuses novelty chrome and dark "AI" styling.

OWN-WORLD: A cool neutral shell (zinc greys) with a floating white work panel, one iris-blue accent for actions and selection, amber reserved for pending review, and plain status colours (grey To do, amber-orange In progress, green Done). System UI type, small radii, hairline borders, drawn SVG icons in one stroke weight.

STORY: The visitor sees the kickoff note, follows a link to NEX-1 or the graph, asks what is outstanding, and then steps through two pending changes with the review bar.

FIRST VIEWPORT: Top bar with the brand, Ctrl K search, New and the fictional-data dot. Left sidebar: the workspace switcher, Home, Notes, Graph, Projects, Calendar, Notifications, then Settings. The white panel holds Home: a centred Ask composer showing "AI is off", recent conversations, due-soon issues, and the "Apply fixed demo changes" action.

FORM: canon (the standing exit, taken by Will), seed: 1d25ae149b5cb4e8.

SIGNATURE: The pending change glows amber once with an ease-out fade, then keeps an amber "Pending review" marker. The same change shows on the board card and the calendar.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The graph view is listed as outside the first release in the PRD. It is in the wireframe at Will's request; adding it to the app needs a PRD change.
- Dark mode is not designed.
