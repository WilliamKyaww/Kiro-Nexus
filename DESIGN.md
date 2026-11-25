---
name: Nexus
description: A calm local-first notebook and project board, where every agent change waits in amber for the user's decision.
colors:
  accent: "#4a52cf"
  accent-ink: "#3a41b0"
  accent-soft: "#eef0fd"
  accent-line: "#c8ccf6"
  accent-on-dark: "#5058d8"
  focus-on-dark: "#aab0ff"
  pend: "#8f5200"
  pend-soft: "#fff4d8"
  pend-line: "#ecc06a"
  pend-wash: "#fffcf3"
  st-todo: "#8a8a95"
  st-progress: "#c96f00"
  st-done: "#2b9a68"
  bad: "#be3220"
  teal: "#0f8f80"
  violet: "#7552cc"
  ink: "#17171c"
  ink-2: "#474751"
  ink-3: "#686873"
  line-2: "#d3d3db"
  line: "#e4e4ea"
  hover: "#e8e8ed"
  shell: "#f2f2f5"
  sunk: "#f7f7f9"
  panel: "#ffffff"
  review-night: "#1b1b21"
  review-control: "#2b2b33"
  review-control-line: "#3b3b45"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.35
  section:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-reading:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.5
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  tag:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 650
    lineHeight: 1.5
  mono:
    fontFamily: "Cascadia Mono, ui-monospace, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  tag: "5px"
  inset: "6px"
  control: "7px"
  row: "8px"
  card: "9px"
  container: "12px"
  float: "14px"
spacing:
  control-gap: "8px"
  shell-gutter: "10px"
  column-gap: "14px"
  phone-inline: "16px"
  view-top: "28px"
  section-gap: "32px"
  view-inline: "36px"
  doc-inline: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-ink}"
    textColor: "{colors.panel}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
  button-icon:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.control}"
    size: "30px"
  button-icon-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-review:
    backgroundColor: "{colors.review-control}"
    textColor: "{colors.shell}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-accept:
    backgroundColor: "{colors.accent-on-dark}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  search-trigger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "0 6px 0 11px"
    height: "34px"
  composer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.float}"
    padding: "14px 14px 10px"
  select:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  segmented-track:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.row}"
    padding: "2px"
  segmented-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.inset}"
    padding: "0 10px"
    height: "26px"
  chip:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "26px"
  citation:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.inset}"
    padding: "0 7px"
    height: "22px"
  mention:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.tag}"
    padding: "0 6px"
    height: "21px"
  pending-tag:
    backgroundColor: "{colors.pend-soft}"
    textColor: "{colors.pend}"
    typography: "{typography.tag}"
    rounded: "{rounded.tag}"
    padding: "0 7px"
    height: "20px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  nav-item-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  nav-item-current:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "0 5px"
    height: "18px"
  work-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
  board-column:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.container}"
    padding: "8px"
  board-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 12px"
  board-card-pending:
    backgroundColor: "{colors.pend-wash}"
    textColor: "{colors.ink}"
  review-bar:
    backgroundColor: "{colors.review-night}"
    textColor: "{colors.shell}"
    rounded: "{rounded.float}"
    padding: "10px 10px 10px 18px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "9px 14px"
---

# Design System: Nexus

## Overview

**Creative North Star: "The Decision Desk"**

Nexus is a desk for a small team's meetings and work. A cool zinc-grey shell holds one floating white work panel, and inside it a note and the issue it mentions sit one click apart. Everything at rest is quiet: hairline borders, small radii, the platform's own type and a single iris-blue accent for what the user can act on or where they are. The one warm colour is amber, and it is lit only while an agent change waits for the user to accept or reject it. When the review is finished, the amber goes out.

This is a dense working surface in the manner of Linear for the board, Notion or Obsidian for notes and Temporal for the calendar and shell, borrowing their behaviours and none of their branding. Density comes from 13px controls and 14px text on a fixed ramp; calm comes from tonal layering and restraint rather than decoration. The AI is treated like any other part of the workspace: an answer sits on the same white panel, in the same type, with its citations as small iris chips that open the exact heading or issue. Nexus refuses novelty chrome and dark "AI" styling.

This system is a proposal for Will first and then Hein, who owns Nexus's final visual identity, and it can change until both agree. It is recorded from the static wireframe in `wireframe/` (`index.html`, `wireframe.css` and `wireframe.js`), whose `:root` custom properties are the source of the tokens above. It has not yet been applied to the real app in `apps/`. A few values are literals in the stylesheet rather than custom properties (Amber Paper, Lit Iris, Pale Iris and the Review Night set); they are recorded as tokens so the app can adopt them as such. Dark mode is not designed.

**Key Characteristics:**
- A cool zinc shell with one floating white work panel and 1px hairline borders.
- One accent, iris, for actions, selection, links and citations.
- Amber means "waiting for your decision" and nothing else.
- Status reads by glyph shape first and colour second.
- The platform system stack in half-step weights, with tabular figures for dates and keys.
- Flat at rest; shadows only on things that float or can be picked up.
- One authored motion: the amber glow when a change lands.

## Colors

A restrained palette of cool zinc neutrals with one iris accent, one reserved amber state and small, plain status marks.

### Primary
- **Iris** (#4a52cf): primary buttons (New, Send), the brand tile, the current sidebar item's icon, today in the calendar, checked boxes in notes, the notifications badge, the 2px focus outline and graph issue nodes. White text on Iris is 6.2:1.
- **Deep Iris** (#3a41b0): text links, wikilinks, citation text, the current note in the file tree and the hover state of a primary button.
- **Iris Mist** (#eef0fd): fills for citations, the Ask tag, the current file, the selected palette result, calendar issue entries, a board column under a drag and the composer's focus ring.
- **Iris Hairline** (#c8ccf6): borders of citations and the focused composer, link underlines at rest and the board drop target's border.
- **Lit Iris** (#5058d8): Accept and Send correction on the dark review bar, where Iris would sit too dark. A stylesheet literal.
- **Pale Iris** (#aab0ff): the focus outline and caret on the review bar. A stylesheet literal.

### Secondary
Review Amber is a reserved state, not a second accent.
- **Review Amber** (#8f5200): text of pending tags and pending values, the fill of a checked box whose change is pending, the reduced-motion outline and the pending dot in the phone calendar. 5.7:1 on Amber Wash.
- **Amber Wash** (#fff4d8): the fill of pending tags, pending issue properties, pending checklist rows and pending calendar entries.
- **Amber Hairline** (#ecc06a): the border of pending items. It is solid on rows, cards and tags, and dashed on a pending date chip and on the replaced value.
- **Amber Paper** (#fffcf3): the lighter fill of a whole pending board card or linked-issue card, so a large surface is marked without shouting. A stylesheet literal.

### Tertiary
Status and category colours, used only in small marks.
- **Pebble** (#8a8a95): the To do ring. 3.4:1 on white.
- **Ember** (#c96f00): the half-filled In progress ring. At least 3:1 on white and on Amber Wash.
- **Fern** (#2b9a68): the filled Done ring, the "Recorded facts" marker in an answer and a done issue's dot in the phone calendar.
- **Brick** (#be3220): late due dates, deadlines in the calendar and the "Discrepancies" marker in an answer. 5.7:1 on white.
- **Lagoon** (#0f8f80): calendar events, drawn as a round dot.
- **Heather** (#7552cc): project identity, as the project tile and the project dot in the sidebar.

### Neutral
- **Graphite** (#17171c): primary text, the selected tab's underline, and the surface of the tooltip and toast.
- **Slate** (#474751): secondary text, sidebar labels and filled priority bars.
- **Zinc** (#686873): meta text, resting icons, placeholders and pane labels. 5.5:1 on white and 4.9:1 on Shell.
- **Strong Hairline** (#d3d3db): control borders, empty priority bars, keycaps and dashed placeholders.
- **Hairline** (#e4e4ea): every divider and the border of the panel, cards, columns, tables and boxed lists.
- **Hover Grey** (#e8e8ed): the hover fill of sidebar items and icon buttons.
- **Shell** (#f2f2f5): the app background behind the panel, the sidebar, and text on the review bar.
- **Well** (#f7f7f9): board columns, chips, code, the Markdown source, out-of-month days and row hover inside the panel.
- **Panel White** (#ffffff): the work panel, cards, controls and the composer.
- **Review Night** (#1b1b21): the review bar. A stylesheet literal.
- **Night Control** (#2b2b33): Previous, Next, Reject, Done and Skip on the review bar. A stylesheet literal.
- **Night Hairline** (#3b3b45): the borders of those buttons. A stylesheet literal.

### Named Rules
**The Amber Lamp Rule.** Amber is lit only while a change awaits review. It never marks a warning, a priority, a highlight, a hover or the brand. When the last change is accepted or rejected, no amber remains on the screen.

**The One Iris Rule.** Iris is the only accent. It marks what acts (primary buttons, the Ask tag), where the user is (the current item, today, the selected result) and what opens elsewhere (links, citations, calendar issue entries). Nothing is iris for decoration.

**The Glyph-First Status Rule.** Pebble, Ember and Fern appear only inside small drawn marks: the status ring, a calendar dot or an answer's section marker. They never fill a card, tint a column or colour text. This is what keeps Ember from reading as Review Amber, because the two share a hue.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif)
**Body Font:** Segoe UI Variable Text (with the same fallbacks)
**Label/Mono Font:** Cascadia Mono (with ui-monospace, Consolas, monospace), for Markdown source, code and file paths only

**Character:** One platform family in two optical sizes. The Display cut tightens titles with slight negative tracking; the Text cut carries everything from 11px to 16px. The half-step weights (550 and 650) rely on the variable Segoe UI faces on Windows; other systems round them to the nearest weight they have.

### Hierarchy
- **Display** (650, 32px, 1.25, -0.02em): note titles. The Home greeting uses it at 30px, and both drop to 25–26px on a phone.
- **Headline** (650, 24px, 1.25, -0.015em): view titles such as Graph, Notifications and Settings. The issue title uses it at 26px and the calendar month at 22px.
- **Title** (650, 19px, 1.35): headings inside a note, such as Decisions and Actions.
- **Section** (600, 14px, 1.4): section headings in the interface, such as a settings group or "Try the review flow". Pane and group labels use 12–13px at 600 in Zinc, in sentence case.
- **Body** (400, 14px, 1.5): all interface text.
- **Body reading** (400, 16px, 1.7): note bodies, at a measure of 68ch. Issue descriptions use 15px at 1.65 on the same measure.
- **Label** (550, 13px): buttons, tabs, segmented controls, links and the file tree.
- **Caption** (400, 12px): dates, meta lines, column counts and calendar entries, with tabular figures.
- **Tag** (650, 11.5px): pending tags and review states. Weekday headers use 11.5px at 600.
- **Mono** (400, 13.5px, 1.7): the Markdown source. Inline code uses 12.5px.

### Named Rules
**The Operate Stack Rule.** Screens people work in, the app and this wireframe, use the platform stack above and ship no web font. This rule does not extend to a landing page, the submission video or any other brand surface, which should source its own display face.

**The Half-Step Weight Rule.** Hierarchy moves in half steps: 400 for reading, 500 for sidebar labels and chips, 550 for controls and emphasis, 600 for section headings and the current sidebar item, and 650 for titles, keys and tags. 700 appears only on the letter inside a tile or an avatar.

**The Tabular Figures Rule.** Dates, times, counts and issue keys use tabular figures, so columns of dates and keys line up.

## Layout

The shell is a grid of a 236px sidebar and a fluid column under a 52px top bar. The work panel sits 10px in from the right and bottom edges, with a Hairline border and 12px corners, so it reads as a sheet laid on the shell. Views have 28px of padding at the top, 36px at the sides and 44px at the bottom, with the title on the left and its controls on the right.

Each view keeps the width its job needs. Home and conversations are centred at 760px, and Home starts 5vh down. Notifications and Settings are centred at 860px. Notes use three panes divided by hairlines: files at 220px, the note in the middle with a 48px inset and a 68ch measure, and details at 264px. An issue has its body beside a 290px properties column with a 40px gap, up to 1120px. The graph is a canvas beside a 280px side panel. The board has three equal columns of at least 250px with 14px gaps, and cards stack 8px apart. The note bar and the issue properties stay pinned while the panel scrolls.

Spacing follows a 2px-step rhythm rather than a 4px or 8px grid. Inside components most gaps are 6–12px, between blocks 14–24px, and between sections 32–44px. Controls are 32px tall, icon buttons 30px, chips and segments 26px, and tags and citations 20–22px.

At 1180px and below, the note details move under the note as an auto-fit grid of 190px tiles. At 900px and below, the sidebar becomes a 268px drawer over a scrim, opened from a menu button. The panel then fills the width with no margin or corners, the note, issue and graph layouts stack into one column, and the file tree becomes a scrolling row of outlined chips. At 640px and below, view padding is 20px, 16px and 32px. Search and New shrink to 34px icon buttons, and Home moves "Try the review flow" above its lists. Board columns become 84vw panes with scroll snapping, and the calendar opens in Agenda. Month cells shrink to 58px, with each entry drawn as an 8px dot. The review bar stacks, with its four buttons in a grid.

**The Bar Never Covers Rule.** While a review is open, the panel's bottom margin grows by the review bar's measured height plus 20px, and the month grid shrinks its rows to match, so the review bar never covers content.

## Elevation & Depth

Depth is tonal first and hairline second: the Shell lies behind the Panel White sheet, the Well is one step down inside it, and 1px Hairline borders do most of the separating. Shadows are soft, cool-tinted and low. They appear on things that float above the work or can be picked up, never on rows, lists or sections.

### Shadow Vocabulary
- **Rise** (`box-shadow: 0 1px 2px rgb(18 18 28 / .06)`): resting board cards, the workspace switcher and the current sidebar item, which pairs it with a 1px Hairline ring.
- **Panel whisper** (`box-shadow: 0 1px 3px rgb(18 18 28 / .04)`): the work panel.
- **Lift** (`box-shadow: 0 6px 14px -8px rgb(18 18 28 / .24)`): a board card under the pointer, showing that it can be dragged.
- **Composer** (`box-shadow: 0 8px 22px -12px rgb(18 18 28 / .22), 0 1px 2px rgb(18 18 28 / .05)`): the Ask composer. On focus, a 3px Iris Mist ring joins it.
- **Pop** (`box-shadow: 0 14px 36px -10px rgb(18 18 28 / .26), 0 2px 8px rgb(18 18 28 / .08)`): the review bar, the command palette, the tooltip, the toast and the phone drawer.
- **Scrim** (`background: rgb(18 18 28 / .28)`): behind the command palette and the phone drawer.

### Named Rules
**The Hairline First Rule.** Separate with a Hairline border or a step to the Well before reaching for a shadow. A shadow means the thing floats or moves.

**The Night Overlay Rule.** Dark surfaces are for things that float above the work and then leave: the review bar in Review Night, and the tooltip and toast in Graphite. The work panel and everything on it stay light.

## Shapes

Corners are small and graded by size: 5px for tags, mentions and pills inside text, 6px for inner pieces such as segments, citations and tree items, 7px for controls, 8px for rows, 9px for cards and the search field, 12px for containers such as the panel, columns, boxed lists and the month grid, and 14px for the floating composer, review bar and palette. Circles are kept for avatars, status rings, the today marker, the unread dot and event dots. Every border is 1px, except the 2px focus outline, the 2px selected-tab underline, the 2px bottom edge of a keycap and the 1.5px box of a note checklist.

Icons are drawn as SVG on a 24px grid and shown at 16px, with a 1.75 stroke and round caps and joins. Status rings are the exception: a 2px ring at 15px. Priority is three 3px bars rising 5, 8 and 12px, filled in Slate from the left (one for low, two for medium, three for high), and urgent is a filled rounded square with a white exclamation mark.

A dashed border marks something not yet real: an empty column, the "Try the review flow" block, the empty provider state, a pending date and the value it replaces. Saved content always has a solid border.

## Components

### Buttons
Squared, quiet and compact.
- **Shape:** gently squared corners (7px), 32px tall, 12px side padding, a 13px label at 550 and a 16px icon 6px from it.
- **Primary:** an Iris fill with a white label, used for New and Send. Hover deepens it to Deep Iris. Send stays disabled at 45% opacity while AI is off.
- **Secondary:** Panel White with a Strong Hairline border and a Graphite label, used for "Apply fixed demo changes", Today and "Send test reminder". Hover moves the fill to the Well and darkens the border slightly.
- **Hover / Focus:** colour transitions of 120ms; focus is a 2px Iris outline at a 2px offset.
- **Icon:** a 30px transparent square with a Zinc icon; hover adds a Hover Grey fill and turns the icon Graphite. An outlined 32px variant, white with a Strong Hairline border, steps the calendar between months.
- **On the review bar:** Night Control buttons with a Night Hairline border and a Shell label, with Accept in Lit Iris.
- **Text link:** Deep Iris at 13px and 550, with an Iris Hairline underline at a 3px offset that turns solid on hover. Wikilinks in notes use the same treatment at reading size.

### Chips
- **Context chip:** 26px, a Well fill, a Hairline border, 7px corners and 12.5px Slate text with a 14px icon. It shows the workspace, and "AI is off" with a grey dot.
- **Citation:** 22px, an Iris Mist fill, an Iris Hairline border, 6px corners and 12px Deep Iris text at 550, led by a 12px icon of the target type (a note or the board). It sits inline in an answer and opens the exact heading or issue.
- **Mention:** an issue key inside a note, 21px, a Well fill, a Hairline border, 5px corners and Slate text at 650. Hover darkens the border and text.
- **Segmented control:** a Well track with 2px padding and 8px corners. The selected segment is Panel White with a Hairline ring and a faint shadow. It is used for Ask and Edit, Source and Preview, and Month and Agenda.
- **Badge and counts:** the Notifications badge is an 18px Iris pill with an 11px white count. Column counts and project keys are Zinc at 11–12px, with keys in a Hairline outline.

### Cards / Containers
- **Corner Style:** 9px for board cards and linked-issue cards; 12px for the panel, columns, boxed lists, answers and placeholders.
- **Background:** Panel White for cards and answers, and the Well for board columns and placeholders.
- **Shadow Strategy:** Rise at rest and Lift on hover for board cards, and Panel whisper for the panel. Lists and answers are flat (see Elevation & Depth).
- **Border:** a 1px Hairline on everything; dashed Strong Hairline on placeholders.
- **Internal Padding:** 10px by 12px for a board card, 8px for a column, 12px by 16px for a boxed-list row, and 18px by 22px for an answer.
- **Board card:** the key and assignee avatar on top, the title at 550, then a meta row of priority bars, the due date, a pending tag and a link icon when a note is linked. It shows a grab cursor, and while dragging it drops to 45% opacity. A pending card has an Amber Hairline border and an Amber Paper fill.
- **Board column:** a header of a 13px title and a tabular count, then the cards. A column under a drag turns Iris Mist with an Iris Hairline border.

### Inputs / Fields
- **Composer:** Panel White, a Strong Hairline border, 14px corners, the Composer shadow and a borderless 15px textarea with an Iris caret. Under the text is a tool row: the Ask and Edit segments, context chips, a provider link and Send. Focus inside it turns the border Iris Hairline and adds the 3px Iris Mist ring. A compact one-row version, with 12px corners, takes follow-ups.
- **Search trigger:** 34px, Panel White, a Hairline border, 9px corners, Zinc placeholder text and Ctrl and K keycaps (11px at 550, a Strong Hairline border with a 2px bottom edge, 4px corners). It opens the command palette: a 600px dialog with 14px corners, a 50px field row and results whose selection is Iris Mist, over the Scrim with the Pop shadow.
- **Select:** 32px, Panel White, a Strong Hairline border and 7px corners. The status and priority selects on an issue are borderless until hovered.
- **Checkbox:** the native control with an Iris accent colour. A note checklist draws an 18px box with 5px corners that fills Iris when checked, or Review Amber when the check is a pending change.
- **On the review bar:** the feedback field is a 32px dark field with a Pale Iris caret.
- **Disabled:** 45% opacity.

### Navigation
- **Sidebar:** it sits on the Shell, with the workspace switcher at the top (white, a Hairline border, 9px corners and Rise). Items are 32px, with 7px corners, a 16px Zinc icon 10px from a Slate label at 500. Hover fills Hover Grey and turns the text Graphite. The current item becomes Panel White with a Hairline ring and Rise, its label goes to 600 and its icon turns Iris. Group labels are 12px at 600 in Zinc, and Settings is pinned to the bottom.
- **Top bar:** the brand (a 24px Iris tile with two linked white rings, and the name at 15px and 650), a search trigger up to 520px wide, and at the right the data dot and New.
- **Tabs:** 34px, 13px Zinc labels at 550; the selected tab is Graphite with a 2px Graphite underline on a Hairline rule.
- **Breadcrumbs:** 13px Zinc with 14px chevrons; the current segment is Graphite at 550.
- **Phone:** the menu button slides the sidebar in as a 268px drawer with Pop over the Scrim, in 220ms on the ease-out curve.

### Review Bar and Pending Marker
The signature of Nexus: one floating bar for deciding, and the same amber marker wherever the change applies.
- **Review bar:** Review Night, 14px corners and Pop, centred over the panel, up to 860px wide and 10px above the bottom edge. On the left is "Change 1 of 2", then where and what changed, a state pill and how many changes still await review. On the right are Previous, Next, Reject and Accept; Done replaces Reject and Accept once every change is settled. Reject opens a feedback row that asks what was wrong or what should be kept, with Send correction and Skip.
- **State pills on the bar:** Pending in dark amber with a pale amber label, Accepted in dark green with a pale green label, and Rejected in dark red with a pale red label, all at 11.5px and 650 with 5px corners.
- **Pending marker:** on the page, a pending item has an Amber Wash fill, an Amber Hairline border and a 20px "Pending review" tag. A pending date chip uses a dashed Amber Hairline, and the value it replaces sits beside it, struck through in Zinc ("was 5 Dec 2026"). Screen readers hear "pending review". The same change is marked on the note, the issue, the board card and the calendar entry.
- **The glow:** when the bar moves to a change, its target glows once. An amber outline 5px out and a pale amber fill fade to nothing over 1.9s on the ease-out curve, leaving the steady pending marker. Under reduced motion it is a static 2px Review Amber outline at a 3px offset, and every transition is off.

**The One Glow Rule.** The glow is the only authored animation. Everything else is a state change of 120–250ms on the ease-out curve.

### Calendar Entries
- **Month grid:** a fixed table with a Hairline border and 12px corners. Out-of-month days are the Well, and today's number sits in a 24px Iris circle.
- **Entries:** 12px with 5px corners. A due issue is Deep Iris on Iris Mist with its status ring; a done issue is Zinc on the Well and struck through; an event is a Lagoon dot with its time; a deadline is Brick text with a square dot; and a pending issue has a dashed Amber Hairline on Amber Wash. At phone width each entry becomes an 8px dot in the same colour family.

## Do's and Don'ts

### Do:
- **Do** mark every pending value in three ways: an Amber Wash fill with an Amber Hairline border, a "Pending review" or "Pending" tag, and screen-reader text. Show the value it replaces beside it, struck through.
- **Do** show one pending change everywhere its item appears (the note, the issue, the board card and the calendar entry), so the user can decide where it applies.
- **Do** pair each status colour with its ring shape (empty, half-filled, filled with a check), so status reads without colour.
- **Do** separate with a 1px Hairline (#e4e4ea) or the Well (#f7f7f9) before using a shadow.
- **Do** give every interactive element a 2px Iris outline at a 2px offset on focus, and Pale Iris (#aab0ff) on the review bar.
- **Do** keep notes and issue descriptions to a 68ch measure, and check every view at 390px.
- **Do** draw icons as SVG on a 24px grid with a 1.75 stroke and round caps and joins.

### Don't:
- **Don't** use amber for anything except a change awaiting review (not for warnings, priority, highlights or hover), and don't let Ember leave the In progress ring.
- **Don't** give the AI its own look. Ask answers get no dark panels, gradients, glows, sparkles or special type; they sit on the white panel like a note.
- **Don't** add novelty chrome: gradient text, glass or blur, ornament or decorative illustration. The graph's dot grid is the one patterned surface, because it is a canvas for placed nodes.
- **Don't** add a second accent, or use Lagoon or Heather for actions; they name events and projects only.
- **Don't** fill cards, columns or rows with a status colour; status lives in the ring.
- **Don't** use monospace except for Markdown source, code and file paths.
- **Don't** put a label or eyebrow above a heading, or use Unicode glyphs or emoji as icons.
- **Don't** make the work panel dark or derive a dark theme by inverting these tokens; dark mode is not designed yet.
