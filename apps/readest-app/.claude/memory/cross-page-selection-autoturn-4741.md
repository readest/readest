---
name: cross-page-selection-autoturn-4741
description: Cross-page selection/highlight in paginated mode via extracted useAutoPageTurn; all four selection gestures drive the corner-dwell turn
metadata: 
  node_type: memory
  type: project
  originSessionId: 33b70e98-fb55-467a-b03f-e4065491bc7e
---

#4741: in paginated (non-scrolling) mode, extend a selection/highlight past the
page edge by turning the page mid-gesture. Branch `feat/cross-page-highlight-autoturn`.

**Extracted `src/app/reader/hooks/useAutoPageTurn.ts`** from `useTextSelector` —
the corner-dwell auto page-turn (#1354), now **decoupled from the DOM selection**
so selection-less gestures can drive it. API: `notePoint`/`noteAutoTurnPoint`
(window-coord engagement point), `cancel`, `isAutoTurning`, `onAfterTurn(cb)`
(Set of subs), `cornerAtPoint`, `readingAreaRect`. Liveness at dwell fire-time is
an injected predicate, not `doc.getSelection()`: `noteCorner(corner, isInCorner)`.
`useTextSelector` keeps the dual-signal native liveness (`pointerCornerNow ||
caretCornerNow`); point-only callers use `noteAutoTurnPoint` (last-point liveness).
Pure exports `getReadingAreaRect`, `turnForFocusBeyondPage`, `keyboardTurnDirection`.

**Key trap:** the old `armDwell` required a valid DOM selection to turn. Instant
Highlight (`user-select:none` + CFI overlay) and AnnotationRangeEditor (CFI
overlay) have **no** DOM selection, so the machine refused to turn for them. The
decoupling is what makes them work at all.

**Four gestures, all feeding the one machine** (`useTextSelector` re-exposes
`noteAutoTurnPoint`/`cancelAutoTurn`/`onAutoTurn` to the editors via `Annotator`):
1. Instant Highlight drag — `handlePointerMove`/`handleNativeTouchMove` feed the
   finger corner. `useInstantAnnotation` now **DOM-anchors the start** (`startPosRef`
   = `{node,offset}` at pointer-down; `buildRangeFromAnchor` builds anchor->end each
   move) so it survives the scroll; relaxed the pointer-up `distance<10` cancel with
   `&& !previewAnnotationRef.current`. See [[instant-highlight-tap-paginate]].
2. `SelectionRangeEditor` handle drag — already DOM-anchored the fixed end; just
   feed `noteAutoTurnPoint(point)` + cancel + re-emit.
3. `AnnotationRangeEditor` handle drag — `useAnnotationEditor` changed from
   `handleAnnotationRangeChange(startPt,endPt)` (`buildRangeFromPoints` resolved BOTH
   ends from window coords -> lost previous page) to `applyAnnotationRange(range,...)`;
   component anchors the non-dragged end (`fixedAnchorRef`) + builds via
   `rangeFromAnchorToPoint` like SelectionRangeEditor.
4. `Shift+Arrow` keyboard adjust (#4728) — `useBookShortcuts.adjustTextSelection`,
   after `extendSelectionFromContents`, **immediate turn-on-cross** (no dwell):
   `keyboardTurnDirection(contents, getReadingAreaRect(...))` -> `view.next()/prev()`
   when the extended focus leaves the page. Desktop-only; gated `!scrolled`.

**After-turn re-emit:** active gesture subscribes `onAfterTurn` to rebuild its range
from the held point onto the new page immediately (instant: `reapplyInstantAnnotation`;
editors: `subscribeAutoTurnReemit` -> `updateFromDraggedPoint(lastPoint)`). Native
selection does NOT subscribe (browser extends its own). The Android #873 scroll-pin
(`selectionPosition`) is re-anchored after every turn via `onAfterTurn` in useTextSelector.

`focusCaretWindowPos` promoted `useTextSelector` -> `src/utils/sel.ts` (keyboard reuse).
Scope: within-section column turns only (a Range can't span two iframe docs).
Tests: `useAutoPageTurn.test.ts` (21), `useTextSelector-instantTurn.test.ts`,
`useInstantAnnotation.test.ts`, `useAnnotationEditor.test.ts`; existing autoTurn/
instantHold suites stay green (regression net for the extraction).
