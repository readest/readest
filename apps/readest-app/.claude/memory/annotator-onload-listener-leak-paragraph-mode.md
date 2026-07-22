---
name: annotator-onload-listener-leak-paragraph-mode
description: "Paragraph mode degrades over chapters on Android (#4735) — Annotator onLoad leaked renderer-scroll + native-touch listeners on long-lived objects; per-view fix + the reusable per-section-leak pattern"
metadata: 
  node_type: memory
  type: project
  originSessionId: 980f8d79-9360-4402-bd49-8dd389200c1e
---

PR #4735 (`fix/annotator-input-listener-leak`). Reported: reading a 3000-chapter web novel in **paragraph reading mode** on Android (Z Fold 7), paragraph transitions get sluggish after a few chapters and keep degrading until app restart. Classic per-section-transition resource leak.

**Root cause — Annotator `onLoad` attaches listeners to objects that OUTLIVE the section.** `Annotator.tsx`'s `onLoad` (wired via `useFoliateEvents(view, { onLoad })` to the foliate `load` event, which fires once per section document load) did:
- `view.renderer.addEventListener('scroll', handleScroll)` — never removed
- `view.renderer.addEventListener('scroll', () => repositionPopups())` — anonymous, unremovable
- Android: `eventDispatcher.on('native-touch', handleNativeTouch)` — never `off`'d

`view.renderer` is created ONCE per book (`createElement('foliate-view')` + `view.open()` in `FoliateViewer.tsx`), lives the whole session; the global `eventDispatcher` too. So every `load` permanently adds listeners. **foliate fires `load` for PRELOADED neighbour sections too** (`paginator.js#loadAdjacentSection` → `dispatchEvent(new CustomEvent('load',…))`, `#preloadNext` loads up to 8), so the accrual is several-per-chapter, not one. The doc-scoped `detail.doc.addEventListener(...)` listeners do NOT leak (the section iframe is destroyed by foliate's `#destroyView`, taking them with it). Only the renderer-/dispatcher-scoped ones leak.

**Why paragraph mode + Android specifically.** Every paragraph advance calls `renderer.goTo({index, anchor})` (`focusCurrentParagraph`), which scrolls the renderer container → `paginator.js:~1161` `this.#container.addEventListener('scroll', () => { if(!#isAnimating) dispatchEvent(new Event('scroll')) })` → runs ALL accumulated scroll listeners. Normal paginated reading scrolls only on occasional page turns, so the same leak is far less felt. Cost is REAL on Android: `handleScroll` (useTextSelector.ts, the `#873` selection-pin workaround) early-returns unless `osPlatform==='android'`, then calls `getViewSettings`; `native-touch` is Android-only. Restart recreates the view/renderer → cleared (the reporter's workaround).

**Fix = `useRendererInputListeners(view, {...})` hook** (`src/app/reader/hooks/`): registers the renderer `scroll` + (Android) `native-touch` listeners ONCE per view in an effect keyed `[view, enableNativeTouch]`, with cleanup; handlers routed through refs so re-renders never re-subscribe. The native-touch handler now resolves the CURRENT primary section's doc/index at fire time (`view.renderer.getContents().find(c=>c.index===primaryIndex)`) instead of capturing a load's doc/index (a load may be an off-screen preload — and the old code fan-fired EVERY loaded section's handler per touch, calling handleTouchEnd/handlePointerUp N times; new code fires once = strictly more correct). Dropped the redundant `scroll→repositionPopups` (a dedicated effect already repositions popups on scroll). `listenToNativeTouchEvents()` just sets one global `window.onNativeTouch` that re-dispatches `native-touch` via eventDispatcher — idempotent, fine to call once/view.

**Reusable pattern (the lesson).** Listeners attached inside a per-section / per-event handler (`onLoad`, `load`, relocate, create-overlay) to an object that outlives that event (`view.renderer`, global `eventDispatcher`, `window`, `document`) LEAK one set per event. Audit `addEventListener`/`eventDispatcher.on` inside `onLoad`-style handlers: if the target isn't the per-section `detail.doc` (which dies with the iframe), it must move to a per-view `useEffect` with cleanup. `eventDispatcher` (`utils/event.ts`) stores async listeners in a per-event `Set` keyed by callback reference; fresh closures each call never dedupe → unbounded.

**Verify gotchas.** Hook unit-tested with `renderHook` + a `MockRenderer extends EventTarget` tracking scroll listeners + a mocked `eventDispatcher` Set; assert size stays 1 across 20 re-renders, latest-handler routing, unmount→0, Android gate. NOTE: creating the mock `view` INSIDE the renderHook callback churns view identity → the `[view]`-keyed effect re-runs each render (still no leak — cleanup keeps Set at 1 — but `listenToNativeTouchEvents` call-count grows); hoist `view` outside to mirror the real stable `getView(bookKey)`. Needs on-device Android verification (Android-gated paths). Related: [[paragraph-mode-toggle-resume-4717]], [[tts-sync-paragraph-rsvp-3235]], [[android-nativefile-remotefile-io]].
