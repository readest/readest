---
name: iframe-double-click-word-select
description: Double-click / touch double-tap on a word selects it and fires the instant action or annotation toolbar
metadata: 
  node_type: memory
  type: project
  originSessionId: bac4ae5d-047f-4b4f-8a04-b239beb4d7d7
---

Double-tap (touch) / double-click (mouse) on a word now selects that word — like
a long-press — then runs the configured instant quick action, or raises the
annotation toolbar if none is set. Verified live on Xiaomi 12 (Android).

**The gap:** `iframe-double-click` was posted by `handleClick`
(`src/app/reader/utils/iframeEventHandlers.ts`, gated on `!doubleClickDisabled`)
but had **no consumer** — a touch double-tap did nothing (Android has no native
double-tap word-select; desktop double-click already selects natively via the
`handlePointerUp` path).

**Impl (3 files):**
- `src/utils/sel.ts`: `getWordRangeAt(node, offset)` expands a caret to the
  word-like segment via `Intl.Segmenter` (CJK + Latin), `[start,end]` inclusive
  so a boundary caret still selects the adjacent word; `getWordRangeFromPoint(doc,x,y)`
  resolves the caret (`caretPositionFromPoint`/`caretRangeFromPoint`) then delegates.
- `useTextSelector.ts`: `handleDoubleClick(doc, index, x, y)` selects the word and
  routes through the existing `makeSelection` (guarded so the programmatic
  `selectionchange` echo is ignored). **Guard `if (isValidSelection(sel)) return`**
  — on desktop the browser already selected the word natively (flows through
  `handlePointerUp`), so synthesize ONLY when nothing is selected (touch double-tap).
  No `isUpToPopup` latch: a double-tap is two taps both consumed by double-click
  detection, so no trailing single-click follows that would dismiss the popup.
- `Annotator.tsx`: window `message` listener for `iframe-double-click` resolves the
  visible section doc/index like `handleNativeTouch` (`renderer.getContents()` +
  `primaryIndex`), then sets **`pointerDownTimeRef.current = 0`** before calling
  `handleDoubleClick` so the deliberate double-tap bypasses `handleQuickAction`'s
  `quickActionMinHoldMs` (300ms) long-press gate (mouse already uses 0). Coords:
  `clientX/clientY` from the iframe click are already section-doc-relative, exactly
  what caretFromPoint wants — no window↔frame mapping (unlike `rangeFromAnchorToPoint`).

The branch decision (instant action vs toolbar) reuses the existing Annotator
`selection` effect: `enableAnnotationQuickActions && annotationQuickAction &&
isTextSelected.current ? handleQuickAction() : handleShowAnnotPopup()`. Default
config has `annotationQuickAction: null` → toolbar.

**Tests:** unit `sel.test.ts` (getWordRangeAt/FromPoint), `useTextSelector-doubleClick.test.ts`
(selection routing + desktop guard); e2e `double-click.android.test.ts` + `doubleTap`
helper in `helpers/adb.ts` (two `input tap` in one shell, < 250ms apart). Live CDP
verify: toolbar branch (`.popup-container.selection-popup`) and instant-action
branch (set quick action to Dictionary via header dropdown → `.popup-container.select-text`,
toolbar absent). See [[dblclick-drag-pageturn-4524]], [[instant-highlight-tap-paginate]],
[[tap-to-open-image-table-4600]].
