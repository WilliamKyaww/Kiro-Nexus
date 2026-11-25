# Implementation plan: backlinks and wikilink completion

This is the only checklist for this increment (run 6 stage 4).

- [x] 1. The shared link rule in `packages/markdown` and its unit tests
  - _Requirements: 1.1 to 1.3, 4.1_
- [x] 2. The backlinks endpoint and its tests
  - _Requirements: 2.1, 2.3 to 2.5, 4.1_
- [x] 3. The Backlinks panel, passage targeting, and the preview's ambiguous links
  - _Requirements: 2.1 to 2.5_
- [x] 4. `[[` completion in the editor, with unit tests of its logic
  - _Requirements: 3.1 to 3.6, 4.1_
- [x] 5. Browser evidence in two fictional workspaces, with an outside edit and a restart
  - _Requirements: 4.2_

Verified by Kiro on 2026-11-25, with AI off: `links.test.ts` (5 tests), `backlinks.test.ts` (3),
`wikilinks.test.ts` (7) and `b2-backlinks.spec.ts` (3 in Edge, plus a screenshot run). Typecheck
clean, 300 of 300 unit tests, 62 of 62 E2E with two screenshot runs skipped, and the secret
scan. No human review yet.
