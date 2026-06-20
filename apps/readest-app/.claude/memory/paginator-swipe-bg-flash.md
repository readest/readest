---
name: paginator-swipe-bg-flash
description: Swipe page-turn background flash —
metadata: 
  node_type: memory
  type: project
  originSessionId: 374255ae-fbfd-4933-bc47-555e541fa115
---

Swipe page-turn flash (white↔black pages) in the multiview paginator. Only on
**swipe + animation** (not arrow keys, not animation-off). Repro: mobile
emulator single column, swipe between a transparent page (colour comes from the
host behind, e.g. a white cover) and a CSS-coloured page (e.g. `body{background:#000!important}`).
`page2→page1` (black→white, backward) is 100%. Tell-tale: **slow swipe = big
flash, quick swipe = small flash on the trailing side** (flash width == drag distance).

**Root cause.** `#background` (foliate-js `paginator.js`) was a static
screen-space layer (a `repeat(cc,1fr)` grid coloured by each column's midpoint).
Doc bodies are set transparent (`doc.body.style.background='none'`), so a page's
full-bleed colour is painted by `#background`, NOT the iframe — except pages that
force their colour with `!important`, which keep it in-iframe. During a swipe the
content moves but `#background` did not: (1) the **drag** scrolls via `scrollBy`
with no `#replaceBackground` call (the debounced scroll handler doesn't fire
mid-drag), so the incoming page rendered over the *outgoing* page's stale colour;
(2) the **snap** pre-set the background to the *destination* (`#replaceBackground(offset)`)
then slid only the content for 300ms, so the outgoing page lost its colour
instantly and flashed across the area it still covered. Arrow keys don't flash
because they start from rest (content already aligned with the pre-set destination).

**Fix** (both phases needed — drag-only fix leaves the snap flash):
- `computeBackgroundSegments(views, scrollPos, bgSize, inset, containerSize)` —
  exported pure helper. One full-bleed segment per rendered view at
  `inset + viewOffset - scrollPos`; transparent (`bg===''`) views get no segment
  (host/theme shows through); segments meeting a container edge stretch into the
  full-bleed gutter. `#background` is now `position:relative; overflow:hidden`
  with absolutely-positioned segment divs (not a grid).
- Drag: rebuild every scroll in the container `scroll` listener, gated on
  `!this.scrolled && !this.#isAnimating`.
- Snap (`#scrollTo`): build at the **current** position, then a per-rAF
  `syncBackground` loop reads the animated view's transform
  (`new DOMMatrix(getComputedStyle(child).transform).m41`, m42 for vertical) and
  calls `#replaceBackground(startPosition - tx)` so segments track the content
  every frame. Per-frame rebuild (not a CSS translate) because the incoming
  page's segment must *grow* as it slides in.

Key insight: `expand()` makes a view element exactly `contentPages*columnSize`
wide, so per-view segments == the old per-column grid at rest, but they can slide.

Test: `src/__tests__/document/paginator-background-segments.test.ts` (pure helper).
Visual repro = synthetic `Touch` events via Chrome MCP + an rAF timeline sampling
`#background` segment `{left,width,bg}` + the view transform through drag AND snap.
foliate-js is a submodule — commit there + bump the pointer. See [[issue-4112-scroll-anchoring]].
