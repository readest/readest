---
name: instant-highlight-tap-paginate
description: Instant Highlight quick action swallowed tap/swipe-to-paginate on Android; fixed with a 300ms still-hold gate
metadata: 
  node_type: memory
  type: project
  originSessionId: d92c120f-6272-4366-92b8-e2d8f32dfd52
---

After the 2026-06-19 update, Android users reported tap-to-paginate failing in
paginated mode: tapping TEXT didn't turn the page, only tapping the empty side
MARGINS worked. Trigger = **Instant Highlight** quick action enabled (3rd toolbar
icon / highlighter; setting = `enableAnnotationQuickActions && annotationQuickAction === 'highlight'`).

**Root cause:** `useTextSelector.handlePointerDown` called `ev.preventDefault()` +
`startInstantAnnotating()` on EVERY pointer-down over selectable text. The
`preventDefault` suppressed the native click that drives tap-to-paginate (iframe
`handleClick` → `iframe-single-click` → usePagination). Margins worked only because
`handleInstantAnnotationPointerDown`→`isSelectableContent` returns false there.
The synthetic-mousedown fallback in `handlePointerUp` is dead on Android because the
native-touch `touchend` calls `handlePointerUp(doc, index)` with NO `ev` (Annotator.tsx
`handleNativeTouch`), and `if (isInstantAnnotating.current && ev)` skips.

**Fix (PR/commit on `dev`):** gate instant-highlight engagement behind a still hold
for touch/pen — `INSTANT_HOLD_MS = 300`, `INSTANT_HOLD_MOVE_PX = 10` in useTextSelector.ts.
- `armInstantHold` (touch/pen) records the press, starts a 300ms timer, does NOT
  preventDefault. A tap releases first (`handlePointerUp`/`handlePointerCancel` →
  `cancelInstantHold`) → native click → paginate. A swipe moves first
  (`maybeCancelInstantHoldOnMove`, called in BOTH `handlePointerMove` and
  `handleNativeTouchMove`, compares window-coord `pointerPos` vs `instantHoldStartWindow`)
  → native swipe → paginate. Only a still hold fires the timer → `startInstantAnnotating`.
- Mouse path unchanged (immediate `preventDefault` + start) — click vs. press-drag is
  already unambiguous; matches the existing "mouse shouldn't be time-gated" stance.
- Refactor: `startInstantAnnotating(target, startPoint)` / `stopInstantAnnotating()` no
  longer take `ev`; the down `target` is stored in `instantAnnotationTarget` so the exact
  element gets `user-select` restored (pointerup target may differ after the finger moves).

Two parallel instant-highlight mechanisms share the same enable flag: (1) the
`useInstantAnnotation` live drag-to-highlight (this fix), and (2) the
quick-action-on-selection deferred path (`beginGesture`/`deferredQuickActionRef`/
`pointerDownTimeRef` in Annotator.tsx) which ALREADY long-press-gates touch on
iOS/desktop but not Android. Test: `useTextSelector-instantHold.test.ts`. See
[[keyboard-selection-adjust-4728]] for the adjacent `isPointerDown`/`handleSelectionchange` logic.
