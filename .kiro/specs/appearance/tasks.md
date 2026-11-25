# Implementation plan: light and dark appearance

- [x] 1. Preference schema, profile file, API and first-paint injection
  - `packages/schema/src/appearance.ts`; `GET` and `PUT /api/v1/appearance`; `index.html`
    filled with the stored preference; `/theme-boot.js`.
  - _Requirements: 2.1, 3.1, 3.2, 3.3_
- [x] 2. Semantic tokens and six palettes in the app stylesheet
  - Replace the placeholder colours and every hard-coded colour with tokens. Keep the
    approved light look as Porcelain.
  - _Requirements: 2.3, 3.3, 4.1, 4.2, 4.3_
- [x] 3. The appearance store, the quick switch and Settings → Appearance
  - _Requirements: 1.1–1.4, 2.1–2.6, 3.4_
- [x] 4. Electron's first paint
  - _Requirements: 3.3_
- [x] 5. Wireframe: the same tokens, palettes and controls
  - _Requirements: 1, 2, 3.5, 4_
- [x] 6. Evidence: unit tests, E2E (switch, system, persistence across a port change, drafts
  and review kept, contrast), Electron first paint, screenshots in both modes
  - _Requirements: all_
- [x] 7. Records: PRD-081, DEC-028, `DESIGN.md`, the wireframe brief and the token sidecar
  - Also the architecture data table and API list, `FEATURES.md`, `STATE.md`, the journal,
    and the reference convention in `.kiro/steering/source-boundaries.md` (both spellings of
    the internal-tools folder).

Verified by Kiro on 2026-11-25: typecheck clean, 273 of 273 unit tests, 57 of 57 E2E (one
skipped screenshot run), secret scan and `mcp:smoke` 6 of 6. No human review yet.
