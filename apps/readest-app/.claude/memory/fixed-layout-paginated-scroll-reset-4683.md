---
name: fixed-layout-paginated-scroll-reset-4683
description: "Fit-width tall fixed-layout page opens scrolled-to-end on WebKit page turn (#4683); Blink unaffected; fix = explicit scrollTop=0 on page-turn render"
metadata: 
  node_type: memory
  type: project
  originSessionId: 780a4235-5498-42c8-8286-7021c6fcf1ed
---

#4683: in paginated fixed-layout (PDF / fixed-layout EPUB) **fit-width** mode, when a
page is scaled taller than the viewport (`isOverflowY` true, host gets a vertical
scrollbar), turning to the next page opened the new page **scrolled to the bottom**
instead of the top. Root cause: `FixedLayout` host (`:host{overflow:auto;align-items:center}`
in `packages/foliate-js/fixed-layout.js`) scrolls vertically; `#render`'s `transform`
re-centered `container.scrollLeft` on every render but **never reset `container.scrollTop`**.
On a page turn the freshly-shown page inherited the previous page's offset (≈ bottom, since
the reader scrolled down to finish, and same-size pages share maxScrollTop).

**Engine-specific — WebKit only.** WebKit (Linux WebKitGTK, iOS, macOS WKWebView)
*preserves* a scroll container's offset when `#showSpread` swaps the flow content
(old frame → `position:absolute;visibility:hidden`, new frame appended). **Blink**
(Android WebView, Chrome, WebView2) *resets* scrollTop to 0 on that swap, so the bug
never manifests there. Reporter was on Ubuntu/WebKitGTK `WebView 605.1.15`.

**Fix:** new exported pure helper `computePaginatedScroll({elementWidth,containerWidth,scrollTop,pageTurn})`
→ `{scrollLeft:(elementWidth-containerWidth)/2, scrollTop: pageTurn?0:scrollTop}`.
Thread a `pageTurn` flag into `#render(side, pageTurn=false)`; set `true` ONLY at the
3 navigation entry points (`#showSpread`, `#goLeft`, `#goRight`). Plain re-renders
(ResizeObserver, zoom/scale-factor attr, pageColors, goToSpread same-index re-render)
keep `pageTurn=false` so resize/pinch-zoom of a tall page does NOT jar to the top.
Test: `src/__tests__/document/fixed-layout-paginated-scroll.test.ts` (pure-helper pattern,
like [[booknote-view-autoscroll-4352]] sibling fixed-layout helper tests — the custom
element can't be instantiated in jsdom: no ResizeObserver + getBoundingClientRect=0).

**Verification recipe (the bug is NOT Android-reproducible):** CDP on Xiaomi showed
`view.next()` already yields scrollTop 0 on Blink → can't distinguish fix on Android.
Proved on REAL WebKit instead: auto-running HTML mirroring host CSS + `#showSpread` swap,
opened via `open -a Safari file://…`, screenshot. Safari `AppleWebKit/605.1.15` (== reporter)
showed scrollTop 420/440 (bug) without reset, 0 with reset. readest fixed-layout page turn
goes through `view.next()`/`view.prev()` (`usePagination.ts`), the same path.
