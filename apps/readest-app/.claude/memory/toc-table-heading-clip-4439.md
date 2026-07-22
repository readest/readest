---
name: toc-table-heading-clip-4439
description: "#4400 scroll-wrapper overflow:auto clips negative-margin bleed of decorative layout tables; hoist negative margins onto wrapper"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6d1d7362-d152-4248-93c0-76f6aef92329
---

#4439: on a decorative TOC page (nested layout tables), the **top half of the
`CONTENTS` heading is clipped** in paginated mode (0.11.4 regression; 0.11.2 fine).
Reporter blamed [[table-dark-mode-tint-4419]] but that's dark-mode only — this is
light mode. Real cause is **#4400** (`scrollable.ts` + `getPageLayoutStyles`):

- v0.11.2 sized wide tables with `transform: scale()` — **never clipped**.
- #4391 then #4400 replaced that with wrapping every `<table>` (and display
  `<math>`) in `.scroll-wrapper { overflow: auto }` + `table { max-height: var(--available-height) }`.
- These EPUBs lay the contents out as a nested `<table class="bc" style="margin: -1em 0 0 1em">`
  with `<p class="lh em16 ...">CONTENTS</p>` (`line-height:1em`, inside `div.em06`=0.6em).
  The **negative top margin** pulls the table (and the heading's first line) above
  the wrapper's `overflow:auto` content box, which clips it. Measured: heading top
  ~12.8px above the clip box = exactly `-1em` in the 0.6em context (~58% of the line).
- The `-fit` escape (`SCROLL_WRAPPER_FIT_CLASS` → `overflow:visible`) only checks
  **horizontal** fit (`scrollWidth-clientWidth`). The table's positive `margin-left:1em`
  inflates scrollWidth so it never gets `-fit`, stays `overflow:auto`, and clips.

**Fix** (PR for #4439): `hoistNegativeMargins(el, wrapper, win)` in `applyScrollableStyle`'s
`wrap()` — move any NEGATIVE computed margins from the wrapped element onto the wrapper
and zero them on the element. Keeps the box in place, lets the element sit flush so the
overflow box can't clip it; also de-inflates scrollWidth so a genuinely-fitting table
gets `-fit`. Positive/auto margins are left alone (over-wide tables still scroll; centered
tables stay centered). CSS can't do per-axis `overflow-x:auto; overflow-y:visible`
(spec coerces `visible`→`auto`), so margin-hoisting is the route, not per-axis overflow.

Repro is metric-sensitive (whether the inner table is `-fit`). Tests: browser test
`src/__tests__/document/paginator-table-toc-clip.browser.test.ts` + fixture
`repro-4439.epub` (real foliate paginator, asserts heading top not above its clip box);
unit cases in `scrollable.test.ts`. Verified against the literal book (`321123.epub`,
content-7.xhtml spine idx 12): clipped without fix, clean with it. Related:
[[paginated-texture-occlusion-4399]], [[inline-block-column-overflow]].
