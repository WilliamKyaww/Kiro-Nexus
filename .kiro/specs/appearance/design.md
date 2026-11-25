# Design: light and dark appearance

## Overview

One preference, `{ mode, light, dark }`, chooses the effective theme and its palette. The
document element carries the result as two attributes, `data-theme` (`light` or `dark`) and
`data-palette`. Every colour in the stylesheet is a semantic custom property defined per
`[data-theme][data-palette]` pair. A Settings preview is simply an element with its own pair
of attributes, so it renders the palette with the real tokens.

## Palettes

| Theme | Palette | Character | Accent |
| --- | --- | --- | --- |
| Light | **Porcelain** (default) | The approved wireframe: zinc shell, white panel | Iris |
| Light | **Linen** | Warm paper greys | Deep teal |
| Light | **Mist** | Cool blue-greys | Cobalt |
| Dark | **Graphite** (default) | Neutral graphite, after Linear and Open WebUI | Soft iris |
| Dark | **Midnight** | Blue-black | Sky blue |
| Dark | **Plum** | Violet-black | Lilac |

The names and colours are original. The public references are recorded in the ignored
`docs/design/references/README.md`.

### Semantic tokens

The tokens are surfaces, text, lines, the accent and state colours:

| Tokens | Meaning |
| --- | --- |
| `--canvas` | Behind everything |
| `--rail` | Navigation, kept quieter than the work |
| `--surface` | The work panel |
| `--raised` | The composer, editors, popovers, the review bar and toasts |
| `--sunk` | Columns and secondary fills |
| `--hover` | Hover fill |
| `--ink`, `--ink-2`, `--ink-3` | Primary, secondary and tertiary text |
| `--line` | Quiet separators |
| `--line-strong` | Card and panel borders |
| `--control-line` | Borders that identify a control, at least 3:1 |
| `--accent`, `--on-accent` | Action fills and the text on them |
| `--accent-ink` | Links and citation text |
| `--accent-soft`, `--accent-line` | Selection fills and citation chips |
| `--pend`, `--pend-soft`, `--pend-line` | Awaiting review only |
| `--ok`, `--ok-soft` | Accepted or done |
| `--bad`, `--bad-soft` | Conflict, error and destructive |
| `--focus` | The focus outline |
| `--selection` | Text selection |
| `--shadow` | Raised shadows |
| `--scrim` | Behind dialogs |
| `color-scheme` | Native controls and scrollbars follow the effective theme |

## Working app

- **Preference file:** `<profile>/appearance.json`, schema
  `{ schemaVersion: 1, mode, light, dark }` in `packages/schema/src/appearance.ts`. The
  profile is the same for the browser and desktop routes, and it does not depend on the
  port.
- **API:** `GET` and `PUT /api/v1/appearance`, which need the session like every other route.
  An unknown palette is refused. A missing or unreadable file gives the default (Match system,
  Porcelain, Graphite).
- **First paint:** the service fills the stored preference into `index.html` as attributes
  on `<html>` (`data-mode`, `data-light`, `data-dark`). It is a UI preference, not workspace
  data, so the unauthenticated app shell may carry it. A small external script,
  `/theme-boot.js`, runs before the body. The CSP allows it as `'self'`. It computes the
  effective theme with `matchMedia` and sets `data-theme` and `data-palette`. Without the
  attributes it uses the defaults.
- **Single source of truth:** `apps/web/src/theme/appearance.ts` holds the preference. It
  applies the attributes, listens to `prefers-color-scheme` while in Match system, and saves
  each change with `PUT`. Reads return the in-memory value, so nothing in the React tree
  remounts. Drafts, the conversation and the review position are therefore untouched.
- **Quick switch:** a `role="switch"` button in the rail named "Dark mode", whose
  `aria-checked` is the effective theme. It shows a moon or sun icon and the words "Dark
  mode", with a track and knob. From Match system it selects the opposite mode explicitly.
  Above 760 px the rail is sticky, so the switch stays in view on long pages. At 390 px the
  rail becomes the top of the page, as before, and the switch sits there on every screen.
- **Settings → Appearance:** a radio group for the mode, and two radio groups of palette
  cards. Each card is a native radio inside a label, with a preview, the palette's name, and a
  check icon with the word "Selected" on the current one.
- **Electron:** main reads `appearance.json` from the profile to choose the window's
  background colour. The window therefore never flashes white in dark mode.

## Wireframe

The same six palettes, attribute pairs and controls run in `wireframe/`, with the
wireframe's fictional data:

- **Tokens:** the wireframe keeps its own token names (`--shell`, `--panel`, `--line-2`
  and so on), set per pair to the same values as the app's. Colours that were literal
  (the review bar, tooltips, avatars, graph, pending card wash) are now tokens, derived from
  the palette with `color-mix()` where possible. No colour literal remains outside the token
  section.
- **Preference:** `localStorage` key `nexus-wireframe-appearance`. `wireframe/theme-boot.js`
  runs in `<head>` before the stylesheet paints and exposes the helpers to `wireframe.js`.
  Another open tab picks up a change through the `storage` event.
- **Quick switch:** in the top bar, beside the fictional-data dot. At 640 px and below the
  words are visually hidden (they stay the accessible name) and the icon and knob show the
  state.
- **Review bar:** in the light theme it stays a dark strip over the light panel, as
  approved. In the dark theme it is a raised strip with a visible edge, since a darker strip
  would vanish into the panel.
- **Clash avoided:** the search button's `data-palette` hook, which opened the command
  palette, became `data-command-palette`, because `<html>` now carries `data-palette`.

## Testing

- **Unit:** the preference schema, the resolution of the effective theme, and the injection
  into `index.html`.
- **E2E (Edge):**
  - the quick switch at 1360 and 390 px, by keyboard, with focus kept;
  - Match system following an emulated scheme change;
  - persistence across a reload, and across a service restart on a different port with the
    same profile;
  - a draft and the review position kept while switching;
  - each palette selectable, with Selected shown in text;
  - contrast, computed from the real CSS for every palette: text 4.5:1, control borders
    3:1, and the state pairs.
- **Conversation kept:** `appearance-conversation.spec.ts`, with the provider double (a
  labelled fixture, not AI): the open conversation and a half-typed follow-up survive a
  switch.
- **Wireframe (Edge):** `wireframe-appearance.spec.ts`: the switch and its focus, both
  palette choices, Match system, a reload, 390 px, the review demo in dark, the command
  palette hook, and the computed contrast of all six palettes.
- **Electron:** the stored dark mode at first paint.
- **Screenshots:** Home with the composer, Settings previews, a note, the board and a pending
  review, in both modes at desktop and 390 px.

## Out of scope

Hein's final identity, the calendar and agenda redesign, card ordering, high-contrast and
forced-colours palettes beyond the browser's defaults, and per-workspace appearance.
