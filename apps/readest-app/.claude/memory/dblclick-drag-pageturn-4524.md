---
name: dblclick-drag-pageturn-4524
description: Web double-click-and-drag selection turned the page; deferred single-click fired mid-drag while button held
metadata: 
  node_type: memory
  type: project
  originSessionId: 5fe20151-9768-4e7c-9cee-2aa25da5318c
---

#4524: on Readest Web, **double-click a word then drag** to extend the native
selection also **turned the page** (a plain double-click did not). The user
expects browser-native double-click-drag word-by-word selection without a page
turn.

**Root cause** (`src/app/reader/utils/iframeEventHandlers.ts` `handleClick`):
the first click of a potential double-click schedules a deferred
`postSingleClick()` after `DOUBLE_CLICK_INTERVAL_THRESHOLD_MS` (250ms).
- Plain double-click: the 2nd `click` fires fast, updates `lastClickTime`, posts
  `iframe-double-click`; when the 1st click's timer fires, the
  `Date.now() - lastClickTime >= 250` check is now false → single-click
  suppressed → no page turn.
- Double-click **+ drag**: the user holds the button down on the 2nd click and
  drags, so the 2nd `mouseup`/`click` is delayed past 250ms. At first-click+250ms
  `lastClickTime` is still the 1st click → check passes → `iframe-single-click`
  posted **while the button is still held** → `usePagination.handlePageFlip`
  turns the page.

**Fix**: module-level `isMouseDown` flag (set in `handleMousedown`, cleared in
`handleMouseup`); the deferred `postSingleClick()` returns early when
`isMouseDown` is true (a drag is in progress). Cannot affect a normal single
click — `isMouseDown` is false by the time its deferred timer fires; only a
held button (drag) suppresses it.

**Verification gotcha**: reproduced live by dispatching synthetic
mousedown/mouseup/click to the reading iframe doc (found via deep shadow-DOM
walk; the foliate iframe sits in nested shadow roots, `document.querySelectorAll('iframe')`
returns 0). Watch `iframe-single-click` on `window` 'message' + the
`.progress-info-label` "N / M" page text. NOTE: back-to-back synthetic gestures
share the module's real `setTimeout` deferrals and `lastClickTime`, so a
follow-up "normal single click" repro can spuriously show no single-click — the
vitest unit test (fake timers) is the authoritative regression check, not
chained browser repros. Iframe listeners are attached once
(`detail.doc.isEventListenersAdded`), so a full page reload is required to pick
up edits — Fast Refresh won't re-bind them.

Test: `src/__tests__/reader/utils/iframeEventHandlers.test.ts`. Related:
[[foliate-touch-listener-capture-phase]], [[progressbar-focus-ring-4397]].
