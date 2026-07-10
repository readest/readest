---
name: auto-scroll-teleprompter-4998
description: "Auto Scroll teleprompter mode (#4998, PR#4999): PacedScroller core, useAutoScroll hook, control pill centered on gridcell, scrolled-mode-only View menu toggle"
metadata: 
  node_type: memory
  type: project
  originSessionId: 129a72a3-6d52-4f4c-a499-972c0055b4e3
---

Auto Scroll reading mode (#4998), PR #4999 MERGED 2026-07-08 (merge
f8ad47a41); worktree and local branch cleaned up.
Teleprompter scrolling for scrolled mode only, toggled from the View menu
(Shift+A, `onToggleAutoScroll`), dispatches `autoscroll-toggle` events.

Key structure:
- `PacedScroller` added to `src/app/reader/utils/autoscroller.ts` alongside the
  middle-click `Autoscroller` ([[middle-click-autoscroll-4951]]): constant
  velocity, whole-pixel emission + fractional carry, injected raf/now for
  tests, `PACED_SCROLL_MAX_FRAME_MS` dt clamp (background tab resume). A
  scrollBy callback may stop() the scroller mid-tick; #tick re-checks active
  before re-arming (test covers it).
- `useAutoScroll(bookKey, viewRef)` in reader/hooks, mounted in FoliateViewer:
  scrolls `renderer.containerPosition += sign * delta`; sign = -1 when
  `renderer.scrollProp === 'scrollLeft'` (scrolled+vertical), matching foliate
  paginator.js `offset = -offset` for scrolled vertical (vertical-lr is a known
  upstream FIXME). Manual wheel/drag composes with the paced steps by design
  (no pause-on-wheel). Tap pause/resume consumes `iframe-single-click` via
  eventDispatcher.onSync (same swallow mechanism as middle-click). Stall
  detection: containerPosition unchanged ≥800ms → `view.next()` (hops sections
  under noContinuousScroll) or stop + 'End of book' toast when
  `renderer.atEnd`. Session state mirrored to readerStore
  `viewState.autoScrollEnabled` (new setter) for the ViewMenu checkmark;
  session never persisted, speed IS: `autoScrollSpeed` percent in BookLayout
  (default 100 = 20 px/s base, 25-500 step 25, constants in
  services/constants.ts).
- `AutoScrollControl` pill reuses the ParagraphBar chassis but positioned
  `absolute` (NOT `fixed`): maintainer explicitly wants it centered on the
  book's gridcell, not the viewport — pinned sidebar pushes the reading column
  off window center. (ParagraphBar's #4474 comment argues the opposite for
  paragraph mode; the two are intentionally different.) Fades after 2.5s while
  scrolling, wakes on mousemove/pause, hidden while hoveredBookKey shows bars.
- Adding a field to readerStore ViewState breaks two test fixtures that build
  ViewState literals (reader-store.test.ts, tts-auto-advance.browser.test.tsx).
- i18n: 6 new keys (Auto Scroll, Toggle Auto Scroll, Slower, Faster, Exit Auto
  Scroll, End of book) hand-translated across all 33 locales following each
  locale's existing Scrolled Mode / RSVP Slower-Faster terminology; scanner
  extraction only touched trailing commas (no pruning this time).

Verified live in dev-web with claude-in-chrome (localhost:3001): 20 px/s at
100%, menu gating, pill geometry (pillCenterX == gridcell center != viewport
center).
