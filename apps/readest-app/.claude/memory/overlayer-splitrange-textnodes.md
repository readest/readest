---
name: overlayer-splitrange-textnodes
description: "Overlayer highlight rects — split range by TEXT NODES, not a block-tag selector; li/blockquote text was silently dropped from SVG when highlight also touched a <p>"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58d4b1a1-8823-4474-9966-c96727692e3f
---

Bug class (3rd occurrence): `Overlayer` in `packages/foliate-js/overlayer.js` splits a range into sub-ranges before `getClientRects()` so fully-contained block elements don't contribute border boxes (over-highlighting blank space — fork commit f087826 #10). The split was `querySelectorAll('p, h1, h2, h3, h4')`; 920676b added headings after the same hole; June 2026 the hole reappeared for `<li>`: a highlight spanning paragraphs + a bullet list drew NO rects over the list (li text fell into no sub-range), while a highlight entirely inside the list worked via the `splitRanges.length === 0 → [range]` fallback.

**Fix:** `#splitRange` walks TEXT NODES (TreeWalker, `FILTER_REJECT` on non-intersecting elements prunes subtrees) plus replaced elements (`img, svg`), clipping first/last text nodes to the range boundaries. Text-node line rects never include block border boxes, cover every block type, and can't double-paint (`li > p` nesting). Shared `#getRects(range)` used by both `add()` and `redraw()`.

**Why:** any hard-coded block-tag selector is whack-a-mole (li, blockquote, dd, td, div-paragraphs…) and adding container tags double-paints nested matched tags.

**How to apply:** when highlight/overlay rects miss some content or over-paint blank space, check `#splitRange` in overlayer.js first. Test at `src/__tests__/document/overlayer-highlight-blocks.test.ts` — jsdom has no `Range.getClientRects`; stub the prototype to record `range.toString()` per call and assert covered text. Dev-web picked up the symlinked foliate-js edit on page reload (no server restart needed for next dev, unlike [[paginator-gutter-bleed-asymmetry-4394]]'s note).
