---
name: css-fixed-attachment-negative-margin-5711
description: "#5711 Duokan CSS: background-attachment fixed garbles paginated text; negative margins + background bleed onto adjacent page — both neutralized in transformStylesheet"
metadata: 
  node_type: memory
  type: project
  originSessionId: 29df3162-176d-4595-b3dd-1eba56a95549
  modified: 2026-08-15T17:51:42.602Z
---

Issue #5711 (MERGED 2026-08-16, PR #5729, 3 commits incl. review fixes: function-token + pre-split url() masking, per-side margin resolution, any-painting background gate): two Duokan-authored CSS patterns break in the paginated iframe.

1. **`background-attachment: fixed`** anchors to the transformed multi-column iframe viewport: the image lands far from its element and Blink smears the text painted over it (garbled band). Fix: rewrite `fixed` → `scroll` in `transformStylesheet` (spec-mandated behavior inside a transformed subtree anyway). url() values are masked first so `url(fixed.png)` survives; matches both longhand and `background:` shorthand, multi-layer lists too.

2. **Negative horizontal margins + background** (Duokan full-bleed trick, `margin: -2em -2em 1.5em -2em` sized to Duokan's fixed 2em page padding): columns are not clipped, so the overhang paints onto the adjacent page. Fix: detect and append `margin-left/right: 0 !important` — the reporter's own workaround as policy. The band stops at the column edge (NO full-bleed). A max()-clamp version preserving full-bleed via `--page-margin-*` vars was implemented first and REJECTED by the user as an overcomplicated hack ("simpler even with less compatibility") — don't resurrect it. Gated on: rule paints a background (hanging indents untouched), horizontal component actually negative (`margin: -1em auto` untouched), not vertical writing, `calc()`/`var()` shorthands skipped.

Non-obvious traps hit while reproducing:

- **Issue-attached partial EPUBs can lie**: repro 2's `part0010.xhtml` references `../Styles/style0001.css` but the zip only packed `style0010.css` — the whole stylesheet silently loads as a 0-rule sheet and the bug "doesn't reproduce" until you copy the css to the referenced name and re-zip.
- **`<body id="b2">` decorative corner logos**: foliate's `paginator.js` `getBackground()` reads the body's computed background at load, sets `doc.body.style.background = 'none'`, and repaints it on the pane-sized background segments div. A `no-repeat right bottom` body ornament (Sherlock pipe) therefore stamps the pane's bottom-right corner over Readest's footer/page-counter on every page — pre-existing, cosmetic, NOT part of the #5711 fix. If ever fixed, it belongs in the paginator background-mirroring, not transformStylesheet.
- When hunting "who painted this pixel" in the reader, enumerate computed `backgroundImage !== 'none'` across ALL iframes AND the top document's shadow roots — the painter was a foliate shadow-DOM div, invisible to `elementFromPoint` (canvas-level paint under content).

Related: [[table-cell-overflow-wrap-anywhere-5681]] (same transformStylesheet hub), [[fxl-authored-colors-5649]] (FXL bypasses all transforms).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5711 fixed-attachment garble + negative-margin bleed](css-fixed-attachment-negative-margin-5711.md) MERGED #5729; body corner-logo over footer = paginator bg mirroring, OPEN
