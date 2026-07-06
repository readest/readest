---
name: middle-click-autoscroll-4951
description: "Middle-click autoscroll in scrolled mode (#4951): Autoscroller RAF core + armed-books registry in iframeEventHandlers; scrolls via renderer.containerPosition"
metadata: 
  node_type: memory
  type: project
  originSessionId: d8d21fc2-b63b-4f65-8ca8-f65d9e6b17b2
---

Middle mouse button autoscroll for desktop Tauri apps in scrolled mode
(readest#4951), PR #4955 MERGED 2026-07-06 (merge 6f3b401c2). No settings
toggle: always on for desktop in scrolled mode (maintainer removed the toggle
as unnecessary; middle click has no other use in the reader). The same PR also
shipped a locale sync: 69 keys untranslated on main filled across 33 locales
(agents per language family; scanner-prunable keys preserved).

Key structure:
- `src/app/reader/utils/autoscroller.ts` — pure `Autoscroller` class (RAF loop,
  12px dead zone, 10 px/s per px linear velocity capped 4000, whole-pixel
  emission with fractional carry, held→sticky/drag state machine). Tested in
  `src/__tests__/reader/utils/autoscroller.test.ts` with injected raf/now.
- `useMiddleClickAutoscroll(bookKey, viewRef, containerRef)` hook consumes
  `iframe-mousedown/mouseup/mousemove/wheel/keydown` messages + window-level
  capture listeners; returns anchor (container-relative) for
  `AutoscrollIndicator`. Scrolls with `renderer.containerPosition += delta`
  (public setter; native scroll path, so section preloading works). Axis from
  `renderer.scrollProp` ('scrollLeft' = vertical writing → x axis; increasing
  scrollLeft always moves viewport right even in RTL, no special-casing).
- iframeEventHandlers runs in the parent realm: `setAutoscrollArmed(bookKey)`
  registry lets `handleMousedown` preventDefault middle button (suppresses
  WebView2's native autoscroll on Windows, avoids double-drive) and
  `handleAuxclick` swallow link opens; `setAutoscrollTracking(bool)` gates an
  `iframe-mousemove` postMessage forwarder so it costs nothing when idle.
- Pointer deltas use screenX/Y (same trick as useTouchEvent pinch) so iframe
  coordinate spaces/transforms don't matter. Anchor window position computed in
  the iframe handler via `event.view.frameElement.getBoundingClientRect()` +
  client-size scale, posted as windowX/windowY on button-1 mousedown only.
- A left click that ends a sticky session must not also turn the page: the
  hook consumes the later `iframe-single-click` via
  `eventDispatcher.onSync` within a 500ms window (usePagination checks
  dispatchSync consumption before paginating).
- Setting `middleClickAutoscroll` in `BookLayout` (default TRUE, user chose
  default-on), toggle in ControlPanel Scroll BoxedList, desktop only
  (`appService?.isDesktopApp`), disabled unless scrolled mode. Web excluded on
  purpose (browsers own middle click).

Related: [[i18n-extract-prunes-keys]] (followed its manual single-key insertion
recipe for the 'Middle-Click Autoscroll' label across 33 locales).
