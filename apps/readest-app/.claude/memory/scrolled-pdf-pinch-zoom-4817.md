---
name: scrolled-pdf-pinch-zoom-4817
description: Scrolled-PDF live pinch-zoom + the cross-page-pinch vs native-selection tradeoff (readest
metadata: 
  node_type: memory
  type: project
  originSessionId: 902324ba-94ee-4c88-804e-ea9f796681f9
---

Live pinch-zoom for scrolled PDF (fixed-layout scrolled mode). The real fix is entirely in foliate-js: PR **readest/foliate-js#43 MERGED** to foliate main as `0fa407c` (on top of #42 `8bcb61e` which already had live pinch + the rect-match anchor + the interactive-when-idle idle-toggle). readest **PR #4817** is therefore **minimal — just the submodule bump to `0fa407c` + one unit test** (`fixed-layout-pinch-zoom.test.ts`, single clean commit `dd39837af`, +39/-1). readest needs NO touch-handling change: `origin/main`'s `useIframeEvents` already detects a two-finger gesture per page (`event.touches` forwarded via `iframeEventHandlers`) and calls `renderer.pinchZoom`. Builds on the scroll-lag scheduler [[pdf-scroll-lag-preload-4795]].

**Abandoned detour (do not re-add):** a host-level cross-page-pinch approach (`multiTouch.ts` `updateSourceTouches`/`flattenSourceTouches`, per-iframe `sourceIndex` binding, `allActiveTouches` reading `e.touches`, and a `usePagination` host-click tap fix) was built then fully reverted. It is unnecessary once cross-page pinch is dropped, and same-page pinch + centre-tap toggle both work through existing `origin/main` code (tap goes iframe -> `iframe-single-click` centre zone; the host-click path is never hit when iframes are interactive).

**Core architectural finding (the crux):** in scrolled FXL, **cross-page pinch and native text selection are mutually exclusive**. Each page is its own iframe; Android **serializes touches across iframe documents** (finger1 on page A gets `touchcancel` the instant finger2 lands on page B — proven via forwarded-touch logs), so a pinch spanning two pages can only be recognized if the *host* owns all touches, which requires `.scroll-page iframe { pointer-events: none }`. But inert iframes kill native selection/taps. So you pick one. User chose **native selection, drop cross-page pinch.**

**Final design (foliate `fixed-layout.js`):**
- `pinchZoom(ratio)` in scroll mode scales the whole `.scroll-container` live (`computeScrollPinchTransform`, transform-origin at viewport centre). `pinchEnd` snapshots the centre page's `getBoundingClientRect` and the commit re-render (`#renderScrollMode`) scrolls it back to that exact rect (`#restorePinchAnchor`) — no jump.
- **No-shift fix:** the inter-page gap must scale with zoom or the committed gaps don't match the transform-scaled preview. `margin: calc(var(--scroll-page-gap,4px) * var(--scroll-zoom,1))` and `#renderScrollMode` sets `--scroll-zoom = scaleFactor`. Verified preview->commit scale MATCH + position jump <=2px.
- Iframes interactive **when idle** (restored `#setScrollIframeInteraction(true)` in `#handleScrollEvent` settle; `#scrolling` flag + interactive-on-load in `#loadScrollPage` so selection works without scrolling first), inert only **during active scroll** (native-smooth). Same-page pinch flows through the per-iframe forwarded-touch path; pdf.js `setupPanningEvents` handles pan (empty-area drag scrolls host) + native selection (text drag). `overflow-x:auto` + `width:max-content` enable horizontal pan of a zoomed page.

**Gotcha — zoom store/attribute desync:** setting the `scale-factor` attribute directly (e.g. a test reset) does NOT update readest's `viewSettings.zoomLevel`. Pinch commit = `round(zoomLevel * lastPinchRatio)`, so a desynced store makes commit diverge from the live transform preview. Real pinches keep them in sync; only direct `setAttribute` breaks it. Cost me a long false-positive "shift" chase — reset zoom via a synthetic pinch, never `setAttribute`.

**Selection re-impl (NOT taken):** host-level selection via `caretRangeFromPoint` + dispatch `selectionchange` on the iframe doc IS viable (readest `handleSelectionchange` -> `makeSelection` -> popup; `getPosition` returns valid coords for scroll-page selections), but loses native OS selection handles/magnifier, and the popup is deferred until a real `touchend` sets `androidTouchEndRef` (Annotator.tsx). Abandoned in favour of native selection.

CDP-verified on Xiaomi (tap toggle, same-page pinch in/out no-shift, vertical scroll, horizontal pan, iframes `pointer-events:auto` when idle). Native selection itself needs a real finger (CDP synthetic touches don't engage the WebView long-press selection gesture).
