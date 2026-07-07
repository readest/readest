---
name: fxl-portrait-autospread-offcenter-4984
description: PDF/FXL auto-spread in portrait rendered the lone page off-center and made taps turn pages
metadata: 
  node_type: memory
  type: project
  originSessionId: f24a5890-de13-4767-bb33-97621f332e44
---

Issue #4984: in fixed-layout (PDF) `spread='auto'` + portrait viewport, the page
was shoved into one half of the screen ("weirdly separate") and almost every tap
turned the page instead of opening the menu.

Root cause (verified in Chrome): `FixedLayout.#render` in
`packages/foliate-js/fixed-layout.js` already hides the non-target page in
portrait (`if (portrait && frame !== target) display:none`) and scales the shown
page as a single page, BUT it kept the spread-centering one-sided inline margin —
left page `marginInlineStart:auto`, right page `marginInlineEnd:auto`. With no
partner page to meet at the spine, that auto margin stranded the lone page in one
half of the viewport whenever it was narrower than the viewport (any zoom < 100%,
e.g. the issue's 50% zoom; or a page whose fit-scaled width < viewport width).
The off-center page then sat over a page-turn tap zone (tap zones are
view-relative: center 0.375-0.625 = menu, else turn — see `usePagination.ts`), so
taps turned the page. Symptom 2 was a consequence of symptom 1.

Fix MERGED (readest PR#4992 + foliate-js PR#50 squash -> foliate main f6dced2, readest submodule bumped to it): added pure `computeSpreadInlineMargins(portrait)`; in portrait
both inline margins are `auto` (centered), in landscape one-sided (pages meet at
spine). It sets BOTH margins explicitly (opposite side cleared to '') because
frames are re-styled in place on rotation (ResizeObserver -> `#render`, no
`#respread`), so a stale `auto` would otherwise linger. NOT fixed by forcing
`spread='none'` in portrait — that duplicates the existing portrait-single-page
path, needs app-layer orientation swapping + `#respread` (cache clear + re-nav),
and overrides the user's chosen setting.

Test: `src/__tests__/document/fixed-layout-portrait-single-page.test.ts`. Related:
[[fxl-spread-spine-seam-4857]] shares this render branch;
[[pdf-text-selection-fontscale-4480]].
