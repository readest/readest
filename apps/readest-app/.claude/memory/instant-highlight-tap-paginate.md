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

**iOS suppression saga (2026-07-18, THREE attempts — final = NATIVE):** the
system long-press selection raced the instant-highlight hold (handles then
fought the editor and captured slide/curl turns, see
[[captured-turn-instant-highlight-scrolllock]]).
1. `target.style.userSelect='none'` at pointer-down: NO-OP on iOS (unprefixed
   inline property ignored + `getPageLayoutStyles` forces
   `-webkit-user-select: text` on html/body; Chromium honors it → Android
   worked, masking).
2. Stylesheet `html, body, body * { -webkit-user-select: none !important }`
   in getStyles: suppressed the selection BUT **broke instant annotation
   entirely — on iOS WebKit `caretRangeFromPoint` returns NULL on
   non-selectable content** (`isSelectableContent` → false → hold never
   arms). iOS-ONLY: desktop Playwright WebKit + Chromium return positions
   fine under user-select:none; verified on iOS sim Safari (also: iOS has no
   `caretPositionFromPoint` at all, only `caretRangeFromPoint`). Reverted;
   user vetoed the whole user-select approach.
3. **FINAL: native gate — `TextSelectionSuppressor.swift`** in
   tauri-plugin-native-bridge (pattern-sibling of ContextMenuSuppressor):
   swizzles WKContentView's selection-gesture gates
   `hasSelectablePositionAtPoint:` + `textInteractionGesture:shouldBeginAtPoint:`
   to return false when suppression is on AND the context is non-editable
   (cut/paste canPerformAction probe keeps note-editor/input selection
   working). Plugin command `set_text_selection_suppressed` (full Rust chain
   + `setTextSelectionSuppressed` in src/utils/bridge.ts), driven by a
   FoliateViewer effect: iOS + instant-highlight mode on → suppress; off /
   reader unmount → restore. `selectstart` preventDefault was ALSO tested and
   is a dead end: iOS never fires selectstart for long-press selections.
**Verified on iOS 18.5 simulator** with a throwaway probe app (swiftc
one-file WKWebView app, no Xcode project: build with
`swiftc -sdk $(xcrun --sdk iphonesimulator --show-sdk-path) -target
arm64-apple-ios15.0-simulator`, `simctl install/launch`, drive long-press
via computer-use mouse_down/wait/up on the Simulator window): long-press
selection fully suppressed while touchstart/clicks still delivered,
caretRangeFromPoint works, input tap-to-focus + caret work. Reusable
workflow for any WKWebView-internals question.
**Lesson: WebKit's text-selection recognizer cannot be beaten from JS —
user-select breaks caret APIs on iOS, selectstart never fires. Gate it
natively at WKContentView, and verify iOS behaviors on the iOS sim engine
(desktop WebKit differs on exactly these internals).**

**Hold-a-word (same day, user-approved design):** with the system selection
suppressed, a pure still hold previously did NOTHING. Now (touch/pen, instant
mode): the 300ms engage calls `handleInstantAnnotationEngage(doc, index)` —
word at the press point via `getWordRangeFromPoint`, drawn as the instant
preview (`engageRangeRef`); release <10px with no drag-paint
(`dragPaintedRef` distinguishes the cross-page drag-returns-to-start case)
commits that word via shared `persistAnnotation` (returns the STORED record —
id kept on cfi collision) and leaves the range editor open by mirroring the
tap-a-highlight state: `setEditingAnnotation(stored)` + selection with REAL
text + `isTextSelected` false → Annotator's selection effect shows options
row + `AnnotationRangeEditor`, zero Annotator changes. PointerUp returns
`'editor'`; useTextSelector consumes the trailing click with the
`isUpToPopup` latch (NOT the 200ms isTextSelected latch, which would dismiss
the fresh editor). Plan: `.agents/plans/instant-hold-word-highlight-editor.md`.
