# Cross-page selection: corner auto-turn (drag) + keyboard turn-on-cross

Issue: https://github.com/readest/readest/issues/4741

## Problem

In paginated (non-scrolling) mode, four selection gestures cannot extend a
selection/highlight past the edge of the page:

1. **Instant Highlight** drag (the highlighter quick action) — drawing a
   highlight by dragging cannot continue onto the next page.
2. **SelectionRangeEditor** handle drag — adjusting a plain (suppressed-native)
   selection's range cannot reach text on another page.
3. **AnnotationRangeEditor** handle drag — editing an existing highlight's range
   (tap a highlight, drag a handle) cannot reach text on another page.
4. **Keyboard selection adjust** (#4728) — `Shift+←/→` (and `Ctrl/Alt+Shift`)
   extends the native selection one char/word into the next, off-screen column
   without turning the page; `adjustTextSelection` even returns `true` to
   suppress the normal arrow-key page turn, so at the page edge the selection
   silently grows off-screen.

Native text selection already auto-turns at the corner (#1354): the selection
caret dwelling in the bottom-right / top-left corner for ~500ms turns the page
and the browser-managed selection extends across the boundary. The gestures
above do not benefit from it.

### Root causes

- The corner-dwell machine lives **inside `useTextSelector`** and its dwell
  fire-time guard requires a live DOM `Selection` in the corner
  (`armDwell` → `isValidSelection(doc.getSelection())`). Instant Highlight and
  AnnotationRangeEditor have **no** DOM selection (the highlight is a
  CFI-based overlay; instant highlight sets `user-select: none`), so the
  machine refuses to turn for them even if fed.
- `useTextSelector.handlePointerMove` `return`s early during an instant-highlight
  drag, so the corner is never fed at all.
- The range editors drag via overlay `Handle` elements in the **top document**
  (pointer-captured), so their pointer stream never reaches the iframe listeners
  that feed the corner machine.
- Ranges that must survive a page scroll have to anchor their non-dragged end to
  a **DOM `{node, offset}`**, not a window coordinate (a coordinate silently
  re-targets to whatever scrolls under it after the turn).
  `SelectionRangeEditor` already does this (`fixedAnchorRef` +
  `rangeFromAnchorToPoint`); `AnnotationRangeEditor`/`useAnnotationEditor` does
  **not** (`buildRangeFromPoints` re-resolves both ends from window points), and
  `useInstantAnnotation` does not (recomputes the range from raw
  `startPoint`→`endPoint` coordinates each move).

## Design

### 1. Extract `useAutoPageTurn(bookKey, contentInsets)` (new hook)

Move the corner geometry (`cornerOf` / `cornerAt` / `getReadingAreaRect`) and the
dwell state machine (`engagedCorner`, `autoTurnTimer`, `isAutoTurning`,
`AUTO_TURN_DWELL_MS`, `AUTO_TURN_CORNER_FRACTION`) out of `useTextSelector` into a
standalone hook. Public surface:

- `notePoint(point: { x: number; y: number } | null)` — feed the current
  engagement point in **window coordinates**; `null` disengages. Computes the
  corner and runs the dwell; the dwell calls `view.next()` (`br`) / `view.prev()`
  (`tl`) — logical next/prev so RTL turns the correct way.
- `cancel()` — disengage and clear the pending dwell.
- `isAutoTurning` — ref, read by the Android scroll-pin.
- `onAfterTurn(cb: (corner) => void): () => void` — subscribe; returns an
  unsubscribe. Fired after each turn settles. Multiple subscribers allowed
  (Set of callbacks).

**Liveness decoupled from the DOM selection.** The dwell fire-time guard becomes
"is the latest fed point still in the corner" (`cornerAt(point) === corner`),
not "is there a valid `Selection`". Consumers that own a selection cancel-on-clear
themselves, so native selection still never turns spuriously. This is the change
that lets the selection-less gestures turn at all.

The hook needs only `bookKey` (for `getReadingAreaRect` / `getView`) and
`contentInsets` (corner inset). It is owned/consumed by `useTextSelector` and
re-exposed to the editors (one shared instance per book view).

### 2. `useTextSelector` consumes the hook

- Replace internal `noteCorner`/`armDwell`/`cancelAutoTurn`/`pointerPos`/
  `engagedCorner`/`isAutoTurning`/corner helpers with calls into the hook.
- Feed points:
  - `handleSelectionchange`: caret → window point via existing
    `focusCaretWindowPos`, `notePoint(caretPoint)` (paginated only) else
    `notePoint(null)` on clear.
  - `handlePointerMove` / `handleNativeTouchMove`: finger → window point,
    `notePoint(point)`, for **both** native selection and instant highlight
    (remove the early `return` that skipped corner feeding during instant
    highlight).
- Keep the Android scroll-pin here (`handleScroll`, `selectionPosition`):
  read `autoTurn.isAutoTurning.current`; re-anchor `selectionPosition` after a
  turn via `autoTurn.onAfterTurn(...)`.
- Re-expose `noteAutoTurnPoint` / `cancelAutoTurn` / `onAutoTurn` (subscribe) in
  the hook's return so the editors can feed the same instance.

### 3. Instant Highlight (`useInstantAnnotation`)

- Anchor the highlight **start** to a DOM `{node, offset}` at pointer-down
  (resolve `findPositionAtPoint(doc, startX, startY)` once; store it). Build each
  range from the anchored start → live end-point so the start survives the scroll;
  fall back to the current coordinate-resolved start when the down point did not
  resolve to a text node.
- Relax the pointer-up "barely moved → cancel" check: do not cancel on
  `distance < 10` when a preview highlight was actually drawn
  (`previewAnnotationRef.current` set) — post-turn the finger can land near its
  start **screen** position while the logical range is large.
- (Re-emit, see §5) provide a way to rebuild the preview from the last pointer
  position after a turn.

### 4. Range editors

Both: on handle-drag move, feed the dragged handle's window point to
`noteAutoTurnPoint(point)`; on drag-end (and drag-cancel) call `cancelAutoTurn()`.

- **SelectionRangeEditor** already DOM-anchors the fixed end (`fixedAnchorRef` +
  `rangeFromAnchorToPoint`) → works across turns once the corner is fed.
- **AnnotationRangeEditor** + **`useAnnotationEditor`**: anchor the non-dragged
  end to a DOM `{node, offset}` captured at drag-start and build the new range
  via `rangeFromAnchorToPoint` (same primitive SelectionRangeEditor uses) instead
  of `buildRangeFromPoints` re-resolving both ends from window points.

`Annotator` passes the re-exposed `noteAutoTurnPoint` / `cancelAutoTurn` /
`onAutoTurn` to both editor components as props.

### 5. After-turn re-emit (included)

When a turn fires mid-hold and the finger/handle has not moved, the live preview
would not extend until the next move. The active gesture subscribes
`onAutoTurn(() => rebuildFromLastPoint())` on drag-start and unsubscribes on
drag-end, so the range extends onto the new page **immediately**. The final
committed range is correct even without this (drag-end resolves the dragged end
from the live post-turn point), so it is separable, but it is what makes the
hold-then-lift case feel right. Native selection does not subscribe (the browser
extends its own selection).

### 6. Keyboard selection adjust (`Shift+←/→`) — immediate turn-on-cross

Unlike the drag gestures, a keystroke is discrete and deliberate, so the trigger
is **not** dwell-in-corner but an immediate turn the moment the focus leaves the
page. In `useBookShortcuts.adjustTextSelection`, after
`extendSelectionFromContents` has extended the selection (the native parent
path, `isNative`), and only in paginated mode:

- Compute the selection focus caret's window position (promote the existing
  `focusCaretWindowPos` from `useTextSelector` to a shared util).
- If the focus is now **outside the visible reading page in the logical extend
  direction** (forward → past the trailing edge; backward → past the leading
  edge; RTL/vertical aware), call `view.next()` / `view.prev()` so the growing
  selection scrolls back into view.

No dwell, no re-emit: `sel.modify('extend', …)` has already moved the DOM
selection, so the turn only needs to scroll it into view. Desktop-only (the
#4728 shortcuts), so the Android scroll-pin is not involved. `adjustTextSelection`
still returns `true` (it owns the turn; the arrow-key page-turn shortcut stays
suppressed). Reuses the pure geometry helpers exported from `useAutoPageTurn`
(`getReadingAreaRect`, a "point beyond page edge" check) rather than the
dwell machine.

## Scope / limits

- Within-section column turns only (the common case). A turn that crosses into a
  new chapter (different iframe document) stops extending the range — the
  inherent limit of a DOM `Range`/`Selection` spanning two documents; native
  selection has the same limit.
- Paginated mode only — every corner feed is gated on `!viewSettings.scrolled`.
- Mouse path for instant highlight is unchanged (immediate engage); the touch
  still-hold gate (`INSTANT_HOLD_MS`) from #4745 is unchanged.

## Testing (test-first)

- `useAutoPageTurn` (new unit test): a point dwelling in the `br` corner for
  `AUTO_TURN_DWELL_MS` calls `view.next()`; leaving the corner before the dwell
  → no turn; `tl` → `view.prev()`. No DOM selection involved — proves the
  decoupling.
- `useTextSelector` (extend autoTurn/instantHold suites): with instant annotation
  engaged, a drag into the corner that dwells → `view.next()` (fails today
  because of the early `return` + selection guard). Existing
  `useTextSelector-autoTurn.test.ts` must stay green (regression net for the
  extraction).
- `useInstantAnnotation`: with `caretPositionFromPoint` mocked to return
  different content for the same coords before/after a simulated scroll, the
  built range's **start stays the anchored node**; a single tap (no preview)
  still cancels.
- `useAnnotationEditor` / AnnotationRangeEditor: the non-dragged end stays the
  anchored DOM position across a simulated scroll.
- Keyboard turn-on-cross: with a focus caret mocked beyond the page's trailing
  edge after `extendSelectionFromContents`, `view.next()` is called; with the
  focus still on the page, it is not. `Shift+←` past the leading edge →
  `view.prev()`. Scroll mode → never turns.

## Files touched

- `src/app/reader/hooks/useAutoPageTurn.ts` — **new**; exports the dwell hook
  plus pure geometry helpers (`getReadingAreaRect`, point-beyond-page check)
  reused by the keyboard path.
- `src/app/reader/hooks/useTextSelector.ts` — consume hook; feed instant
  highlight; re-expose feed/cancel/subscribe; promote `focusCaretWindowPos` to
  a shared util.
- `src/app/reader/hooks/useBookShortcuts.ts` — keyboard turn-on-cross after
  extending the selection.
- `src/utils/sel.ts` — home for the promoted `focusCaretWindowPos` (or a sibling
  shared util) used by both `useTextSelector` and the keyboard path.
- `src/app/reader/hooks/useInstantAnnotation.ts` — DOM-anchored start; relaxed
  cancel; re-emit hook.
- `src/app/reader/hooks/useAnnotationEditor.ts` — DOM-anchored non-dragged end.
- `src/app/reader/components/annotator/SelectionRangeEditor.tsx` — feed/cancel.
- `src/app/reader/components/annotator/AnnotationRangeEditor.tsx` — feed/cancel;
  anchored build.
- `src/app/reader/components/annotator/Annotator.tsx` — pass controls to editors.
- `src/__tests__/app/reader/hooks/*` — new + extended tests.
