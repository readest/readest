---
name: scrolled-header-title-center-4436
description: "Scrolled-mode header chapter title lagged because getVisibleRange picked the topmost sliver view, not the viewport-center section"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c504495-68fe-4a26-b314-644bbc496581
---

#4436 — In scrolled mode the reader header chapter title was wrong vs paginated
mode while transitioning between sections. Title comes from foliate `tocItem =
TOCProgress.getProgress(index, range)`; `index`/`range` come from the
paginator's relocate detail, ultimately from `#getVisibleRange()`.

**Root cause:** the scrolled branch of `#getVisibleRange` (`packages/foliate-js/paginator.js`)
returned the FIRST overlapping view (lowest index = topmost in scroll order).
When the tail of section K is a thin text-bearing sliver at the very top of the
viewport but section K+1 occupies the centre/majority, it returned K's range →
title showed K while the reader was reading K+1. Paginated mode never shows this
because each page belongs to one section. (`comparePoint` end-boundary logic in
`progress.js` is shared by both modes and was NOT the divergence — the view
choice was.)

**Fix:** prefer the view whose visible band covers the viewport CENTRE
(`center = #renderedStart + size/2`; `center >= off && center < off+vSize`);
keep the first valid non-collapsed range as a `fallback` for when no loaded view
covers the centre (very top/bottom of book). Also fixed `#afterScroll` scrolled
fraction to size against `this.#views.get(index)` (the relocated view) instead of
`#primaryView`, since the relocated `index` can now differ from `#primaryIndex`.
`#detectPrimaryView`/`#primaryIndex` left UNCHANGED (drives preload/trim/bg;
guarded by #4112/#3987 tests) — only the relocate index/range moved to centre.

Accepted side effect: scrolled CFI/anchor now reflect the centre section (reopen
lands at centre section top) — minor, arguably better.

**Test:** `paginator-scrolled.browser.test.ts` "should report the section
occupying the viewport centre…" — real paginator + sample-alice, two adjacent
tall linear sections, `setAttribute('no-preload','')` AFTER fill to freeze view
offsets (else backward-preload scroll-compensation shifts the absolute scrollTop
target), nudge-scroll (first debounced scroll only clears `#justAnchored`; need a
2nd to fire `afterScroll('scroll')`), assert relocate `index` == centre section.
See [[issue-4112-scroll-anchoring]].
