---
name: ios-selection-toolbar-flash-defer
description: iOS annotation toolbar flashed during system-handle selection drags; fixed by deferring touch selectionchange processing to handleTouchEnd
metadata: 
  node_type: memory
  type: project
  originSessionId: 81e2afbf-8610-487b-936b-f4066195294c
---

On iOS (non-instant mode), selecting/adjusting text made the annotation
toolbar FLASH. Two long-standing paths fight during a system-handle drag:

- `Annotator.tsx` onLoad attaches a `touchmove` handler that does
  `setShowAnnotPopup(false)` ("popup should not follow the selection while
  dragging") — iOS-only in practice (comment: not fired on Android).
- Every `selectionchange` mid-drag → `handleSelectionchange` (touch input is
  processed immediately) → `makeSelection` → selection effect →
  `handleShowAnnotPopup()` → `setShowAnnotPopup(true)`.

Interleaved at event frequency = flash. Desktop mouse never flashed because
its selectionchange defers to pointerup (`!isTouchInput && isPointerDown`
guard); Android never hides on touchmove.

**Fix (useTextSelector.ts):** touch selectionchange in PAGINATED mode now
defers like desktop: `pendingTouchSelection` ref set in
`handleSelectionchange` when `!isAndroid && isTouchInput &&
isTouchStarted && !scrolled`; `handleTouchEnd(doc?, index?)` (now bound to
doc/index at the Annotator's touchend attachment) processes it ONCE at
release — valid selection → `makeSelection` (popup shows once), invalid →
dismiss. Gates preserved: Android keeps the immediate path (selectionchange
is its primary signal, per-change processing feeds the hyphen repair);
scroll mode keeps it too (its gesture can end in pointercancel with nothing
after); the corner auto-turn caret feed sits BEFORE the deferral so
cross-page native-selection turns still work mid-drag. The Android
native-touch bridge calls `handleTouchEnd()` with no args (never defers).
Side effect: non-highlight quick actions (dictionary etc.) now fire at
finger lift instead of mid-gesture — closer to Android's deferred behavior.
Tests: `useTextSelector-touchSelection.test.ts`.

See [[instant-highlight-tap-paginate]] and
[[captured-turn-instant-highlight-scrolllock]] for the adjacent iOS
selection sagas.
