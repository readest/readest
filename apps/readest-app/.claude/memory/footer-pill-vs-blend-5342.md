---
name: footer-pill-vs-blend-5342
description: "#5342 PDF footer pills paint pure black; mix-blend-difference composites the container as a group, so pill backdrops and the blend cannot coexist"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4d9b8aa-1ffb-495c-8a64-de4c9c07cadc
  modified: 2026-07-26T14:46:39.652Z
---

`ProgressBar.tsx` carried two independent legibility mechanisms that silently
collided for fixed-layout books in **scrolled** mode:

- **#4901 blend**: fixed-layout + !eink → container gets `text-white/75 mix-blend-difference`, so the footer stays readable over a PDF page the app never themes.
- **#5029 pills**: scrolled + !vertical + !stickyBar → each segment gets `progress-pill … bg-base-100/85`, because scrolled mode reserves no bottom band.

`mix-blend-mode` composites the **whole element as a group** against the
backdrop, so the pill's own background is blended too: light-theme
`base-100` (white) differenced against the white PDF page = `#000`. Result was
solid black pills with near-invisible text (reported on Android 0.11.20).

**Fix (MERGED #5347):** blend only when no pill is present —
`bookData?.isFixedLayout && !isEink && !pillClass`. The pill's opaque-ish
backdrop already guarantees contrast in both light and dark themes, so the
blend hack is redundant exactly where it is harmful. Paginated PDFs and the
sticky-bar variant (no pills) keep the blend.

**Rule of thumb:** never put a `mix-blend-*` element around children that carry
their own background — verify the two features when either is touched. The same
pairing exists in `SectionInfo.tsx` (blend for fixed layout), but its scrolled
backdrop (`notch-masked bg-base-100`) is a **sibling** div outside the blended
element, so it is unaffected.

Tests: `src/__tests__/components/ProgressBar.test.tsx`, describe block
"contrast against the page (#4901)". Related: [[pdf-cbz-contrast-view-menu]].
