---
name: pdf-swipe-pan-toggles-menu-5142
description: "#5142 PDF fit-width landscape: vertical pan swipe toggled control menu — gate swipe-up bar toggle on hasVerticalPanning (real isOverflowY), not zoomLevel>100"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0850b532-e636-4efa-95cf-f63b38ca8762
---

Issue #5142 (MERGED 2026-07-17, PR #5160): on paginated (non-scrolled) fixed-layout books, the
swipe-up header/footer toggle in `useIframeEvents.ts` `onTouchEnd` was gated by
`zoomLevel <= 100`. But `isPanningView` counts `zoomMode !== 'fit-page'` as pannable —
**fit-width at 100% zoom in landscape overflows vertically**, so every vertical pan
swipe also toggled the control menu.

Fix: exported `hasVerticalPanning` from `usePagination.ts` (= isPanningView &&
`view.isOverflowY()`, the real renderer overflow from fixed-layout.js) and gate the
toggle on `!hasVerticalPanning(getView(bookKey), viewSettings)` — dropped the
zoomLevel gate entirely (per chrox: check actual vertical-scroll availability, not
zoom level). A zoomed page that still fits vertically now allows the toggle again.

**Why:** zoomLevel is a poor proxy for "swipe will pan" — zoomMode changes effective
scale without touching zoomLevel. `view.isOverflowY()` is ground truth.

**How to apply:** any gesture gate that asks "is this swipe a pan?" on FXL should use
`hasVerticalPanning`/`hasHorizontalPanning` from usePagination, never raw zoomLevel.

Device verify (Xiaomi 13, CDP): release APK needs `--features devtools`
(`pnpm dev-android`) for the `webview_devtools_remote_<pid>` socket — store builds
lack it. Landscape: `settings put system accelerometer_rotation 0; put system
user_rotation 1`. Set fit-width via real UI: tap center → `[aria-label='View
Options']` → `[title='Fit Width']` (rects from CDP, taps via `input tap cssX*dpr`).
Bar visibility probe: computed style of `.header-bar` (visible ↔ `visibility:visible`
+ opacity>0.5). Generated a dependency-free multi-page PDF by hand (raw xref) for the
fixture; validated with vendored `packages/foliate-js/vendor/pdfjs/pdf.mjs` first.
Related: [[android-cdp-e2e-lane]], [[scrolled-pdf-pinch-zoom-4817]].
