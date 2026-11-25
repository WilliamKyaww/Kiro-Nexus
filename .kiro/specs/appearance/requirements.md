# Requirements: light and dark appearance

## Introduction

Nexus gets a usable light and dark appearance in the working app and in the wireframe, with
AI off. The light look follows the wireframe at `5ce82b4`, which Will approved on
25 November 2026: a pale shell, a white work panel, a restrained iris accent and a readable
hierarchy. The dark look is designed on purpose: a calm, neutral graphite with distinct
canvas, navigation, work surface and raised surfaces, an off-white reading colour and legible
secondary text. Amber stays reserved for changes awaiting review.

Will authorised this as stage 2 of overnight run 6 (`.tmp/2026-11-25-kiro-overnight.md`).
It authorises the theme controls and colours in the working app. Hein keeps the final overall
visual identity, the calendar and agenda, and card ordering; this implementation is recorded
for his later review.

- **Traces to:**
  - PRD-070: the same UI in the browser and in Electron;
  - PRD-080: keyboard operation, visible focus and reduced motion;
  - PRD-081 (new): light, dark and Match system, with palettes;
  - DEC-028.
- **Approval:** written and self-reviewed by Kiro under Will's authorisation (run 6).
  Human review is pending.

## Glossary

- **Mode:** the preference, Light, Dark or Match system.
- **Effective theme:** light or dark as rendered now. In Match system it follows the
  operating system.
- **Palette:** a named set of colours for one theme. Each theme has its own selected palette.

## Requirements

### Requirement 1: A quick switch on every screen

**User story:** As a user, I want to switch between light and dark from wherever I am, so
that I can adapt Nexus to the room I am in.

1. The persistent shell shall show one control that switches the effective theme between
   light and dark, on every screen, including at 390 px wide.
2. The control shall be operable by keyboard, have an accessible name and show its current
   state both in text and visually, not by colour alone.
3. Switching shall keep keyboard focus on the control.
4. WHEN the mode is Match system, THEN the switch shall select the opposite of the effective
   theme as an explicit mode.

### Requirement 2: Settings → Appearance

**User story:** As a user, I want to choose Light, Dark or Match system and a palette for
each, and see what I am choosing.

1. Settings shall offer Light, Dark and Match system. A fresh profile shall use Match system.
2. WHILE Match system is selected, Nexus shall follow changes of the system setting without
   a reload.
3. Each theme shall offer at least three original, distinguishable palettes. Light includes
   the approved wireframe look, which is the light default. Dark includes a neutral graphite,
   which is the dark default.
4. The light and the dark palette shall be remembered independently.
5. Each palette shall show a preview of its surface, text, accent and selection together. The
   selected one shall be marked with text and an icon, not by colour alone.
6. A choice shall apply at once, with no Save step.

### Requirement 3: One source of truth, kept across restarts

1. Within each implementation, the mode and palettes shall have a single source of truth, and
   the colours shall be semantic CSS custom properties.
2. The working app shall keep the preference per local profile, across navigation, workspace
   switches, a reload and a relaunch, including when the service starts on a different port.
3. The first paint shall already use the effective theme. Native form controls, overlays, the
   review bar, dialogs, notifications and code blocks shall follow it.
4. Changing the appearance shall keep drafts, the active conversation and the position in a
   review.
5. The wireframe keeps its fictional data and may keep its preference in the browser.

### Requirement 4: Meaning and contrast

1. In every palette, a citation, a change awaiting review, an accepted change and a
   destructive action shall stay distinguishable. Amber shall mean awaiting review only.
2. Normal text shall have at least 4.5:1 contrast on the surfaces it sits on, and large text
   at least 3:1. Boundaries needed to identify a control, such as input borders, shall have
   at least 3:1.
3. Keyboard focus shall be visible in every palette. Disabled controls and status labels
   shall stay readable.
