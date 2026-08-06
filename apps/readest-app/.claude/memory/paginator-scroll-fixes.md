---
name: paginator-scroll-fixes
description: "Aggregator index for resolved/stable paginator, page-turn, TOC, FXL/PDF, and scroll-mode memories"
metadata: 
  node_type: memory
  type: reference
  originSessionId: bd78030b-1892-4a7c-8c99-79084f0310bc
  modified: 2026-08-06T03:23:07.764Z
---

Moved from MEMORY.md to keep the index small. One line per memory; open the linked file for detail.

- Reading ruler: [line-aware](reading-ruler-line-aware.md); #4865 vertical-rl; [#5491 resize anchor](reading-ruler-resize-anchor-5491.md) MERGED #5519; DOM Range anchor, reflow vs turn = anchor visibility
- [#555 slide/curl turns](page-turn-styles-viewtransitions-555.md) · [captured turn swipe gates](captured-turn-instant-highlight-scrolllock.md)
- [captured turn void promise](captured-turn-void-promise-autoturn-revert.md) MERGED #5159; wrappers of view.next must return it
- [layered vertical-swipe random turn](layered-snap-vertical-swipe-random-turn.md) MERGED #5185
- [system selection menu one-off](android-system-selection-menu-one-off.md) likely false positive
- TOC: [expand+autoscroll](toc-expand-and-autoscroll.md); [current row](toc-current-position-row.md); [#4439 clip](toc-table-heading-clip-4439.md); [#4352 booknote](booknote-view-autoscroll-4352.md)
- Paginated bg: [swipe flash](paginator-swipe-bg-flash.md); [#4399 texture](paginated-texture-occlusion-4399.md); [#4394 gutter](paginator-gutter-bleed-asymmetry-4394.md); [#4785 reflow](pageturn-bg-replace-reflow-4785.md)
- [Inline-block column overflow](inline-block-column-overflow.md) `#demoteUnfragmentableBoxes`
- FXL/PDF: [#4683 scroll reset](fixed-layout-paginated-scroll-reset-4683.md); [#4587 spread seam](pdf-spread-canvas-seam-4587.md); #4857 spine seam; [#4984 auto-spread](fxl-portrait-autospread-offcenter-4984.md)
- Scrolled: [#4727 wheel](pdf-scroll-mode-wheel-double-4727.md); [#4436 header center](scrolled-header-title-center-4436.md); [Duokan cover](duokan-fullscreen-cover-scroll.md)
- [#5375 SVG cover stretch](svg-cover-stretch-duokan-5375.md) SUPERSEDED by #5263
- [#5263 Duokan fullscreen cover letterbox](duokan-fullscreen-cover-letterbox-5263.md) ALL MERGED; letterbox + blank cover + unseeded scrollBounds dead swipe; adb gestures deliver NO touchmove
