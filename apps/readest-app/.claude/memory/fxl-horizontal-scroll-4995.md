---
name: fxl-horizontal-scroll-4995
description: "#4995 horizontal scrolling for fixed-layout books: scroll-direction attr, host-level direction:rtl, progression coords, wheel translation; CDP scroll gestures cannot test it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 48bc5696-2015-4f7d-96c4-f4b473b7dbdf
  modified: 2026-08-04T05:40:29.068Z
---

# #4995 Horizontal scrolling mode for fixed-layout books

BOTH MERGED 2026-08-04: foliate#65 (squash 663e630) then readest#5485 (merge 69985e5e5). Rebase lesson: #5480 landed i18n keys concurrently; all 33 locale conflicts were tail-of-file key appends, union-merged from git stages (:1 base additions/removals applied onto :2) with a throwaway script. Worktree submodule `origin` points at the local checkout; push foliate via an added `github` remote. Squash-merged foliate PRs need the app pointer re-aimed at the squash commit (tree-identical, so `git diff old new` empty).

Design decisions that will bite if forgotten:

- **`scroll-direction` attribute** (vertical|horizontal) on `foliate-fxl`, orthogonal to `flow="scrolled"`; app setting `scrolledDirection` in ViewSettings. Direction change destroys+re-inits scroll mode preserving page index.
- **`direction: rtl` must live on the HOST element** (the scroller), NOT `.scroll-container` — scrollLeft sign conventions follow the scrolling element's own computed direction; on a child it never activates and every anchor restore teleports (caught by per-task review, verified in Chromium).
- **Two coordinate spaces** in fixed-layout.js: content coords (anchors, pinch origin; RTL normalized `scrollWidth - clientWidth + scrollLeft`) vs reading progression (`containerPosition`, start/end/atStart/atEnd; RTL = `-scrollLeft`). Auto Scroll works unchanged because fixed-layout has no `scrollProp`, so useAutoScroll's sign defaults +1 and progression absorbs RTL.
- **Wheel translation** `computeScrollWheelDelta` (null on ctrl / vertical overflow / deltaX-dominant / vertical mode): host listener passive:false attached ONLY in horizontal mode, plus the #4727 iframe-doc listener also translates (in horizontal mode the native chain cannot consume a vertical delta, so the first tick of every gesture over an interactive page was swallowed; translating there cannot double-scroll).
- **`saveViewSettings` skipGlobal=true for scrolledDirection** (like zoomMode/spreadMode, unlike webtoonMode) — global save bled 'horizontal' into reflowable books and disabled `snapScrolledDistanceToLines`; usePagination also gates the skip on `layout === 'pre-paginated'`.
- **ViewMenu effect order is load-bearing**: the scrolledDirection effect must be declared BEFORE the isScrolledMode effect so the attribute lands before flow flips (else vertical strip builds then rebuilds).
- **0.5px epsilon guard in `#restoreScrollModeAnchor`**: any programmatic scroll write (even same value) cancels an in-flight smooth scroll (CSSOM spec), and the ResizeObserver's initial callback fires mid `next()` animation.
- UI: 4-icon group in the fixed-layout View menu row (TbColumns1/TbColumns2/TbCarouselVertical/TbCarouselHorizontal), user-requested mid-build replacing a three-item text menu; 'Paginated' i18n key was added then pruned.

**Testing trap:** Chrome-extension/CDP synthetic scroll gestures CANNOT test horizontal wheel translation — they abort with ZERO DOM wheel events when no scroller exists along the gesture axis (verified: window+iframe capture hooks saw nothing while the sidebar scrolled fine). Only JS-dispatched WheelEvents (vitest browser tests) or real hardware exercise the handler. Related: [[duokan-fullscreen-cover-letterbox-5263]] (adb gestures deliver no touchmove).
