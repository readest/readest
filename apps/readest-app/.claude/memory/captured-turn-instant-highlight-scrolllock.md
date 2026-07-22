---
name: captured-turn-instant-highlight-scrolllock
description: Captured slide/curl turns are a parallel swipe path that must mirror EVERY native paginator gate — scrollLocked (instant highlight) and the non-collapsed-selection gate (non-instant selection, iOS 18.7)
metadata: 
  node_type: memory
  type: project
  originSessionId: 871c7b42-61c0-44e7-a1d6-8edb35d80300
---

Instant Highlight's 300ms still-hold gate ([[instant-highlight-tap-paginate]])
worked in **push** mode but NOT in **slide/curl** — a swipe after the hold turned
the page (with the slide/curl effect) instead of extending the highlight.

**Root cause: two independent swipe paths.** foliate's native `#onTouchMove`
(paginator.js) bows out at `if (this.hasAttribute('no-swipe')) return` (~2149),
THEN checks `if (this.#scrollLocked) return` (~2162), THEN the `#layeredTurn` VT
drag (~2179). So:
- **push** (no turn-style, no no-swipe) → native swipe, honors `#scrollLocked`. ✅
- **VT-layered slide** (`turn-style='slide'`, no no-swipe; engines with nested VT
  groups) → native swipe → layered turn, still AFTER the scrollLocked check. ✅
- **captured curl (always) / captured slide (Tauri w/o full VT support)** →
  `applyPageTurnAttributes` sets `no-swipe`, so native swipe returns early and the
  APP-side captured-turn touch interceptor in `useCapturedTurn.ts` (priority 5,
  driven by `iframe-touchmove` → `dispatchTouchInterceptors`) is the swipe handler.
  It began a drag on any >15px horizontal move WITHOUT checking scrollLocked. ❌

`useTextSelector.startInstantAnnotating` sets `view.renderer.scrollLocked = true`
when the hold engages. The captured interceptor is a parallel reimplementation of
swipe-to-turn and must honor the same lock independently.

**Fix (app PR readest#5000 + foliate readest/foliate-js#51, tests:
`useCapturedTurn-scrollLock.test.ts`):**
1. foliate `paginator.js`: add `get scrollLocked()` — it was setter-only, so JS
   couldn't read it back (app `src/types/view.ts` already declared it a readable
   boolean). foliate PR #51 MERGED (squash → `ba57ec8` on foliate main); app
   #5000 bumps the submodule pointer to `ba57ec8` (mergeable, awaiting merge).
2. `useCapturedTurn.ts` touch interceptor, `move` phase, before starting a drag
   (`!state` branch): `if (currentView.renderer.scrollLocked) return false;`.

**Why the `!state` branch is sufficient:** a captured drag needs >15px horizontal
travel, but `maybeCancelInstantHoldOnMove` cancels the hold at >10px — so a drag
can never already be in progress when instant annotation engages; no need to gate
an in-flight drag. See [[page-turn-styles-viewtransitions-555]].

**Second instance (2026-07-18, iOS 18.7, non-instant selection):** the same
parallel-path problem with a DIFFERENT native gate. Foliate `#onTouchMove` also
bows out when the primary view's document holds a **non-collapsed selection**
(paginator.js ~2166, before the scrollLocked check) — that's what lets a
long-press selection / handle drag proceed in push mode. The captured
interceptor lacked it, so on iOS 18.7 (VT gated off → slide/curl always
captured) adjusting a selection >15px horizontally turned the page under the
selection. Fix in `useCapturedTurn.ts` move `!state` branch, after the
scrollLocked check: find the primary doc via
`renderer.getContents().find(c => c.index === renderer.primaryIndex)?.doc` and
return false when its selection is non-collapsed. Tests appended to
`useCapturedTurn-scrollLock.test.ts` (h.selection on the mocked getContents
doc). **Lesson: when auditing the captured interceptor, diff it against the
FULL early-return ladder of foliate's `#onTouchMove`, not one gate at a time**
(remaining native gates it intentionally skips: pinch `visualViewport.scale`,
multi-touch, stylus).

**Fourth instance (stranded beginDrag after instant-highlight release,
~2/3 repro):** after releasing an instant-highlight drag in slide/curl mode
the user saw the DEGRADED JPEG capture stuck on screen (iOS q85 capture =
the overlay frozen at progress 0) and the next turn showed the WRONG page
(off by one), self-healing after one more turn. Mechanism: `handlePointerUp`
→ `stopInstantAnnotating` unlocks `scrollLocked` SYNCHRONOUSLY, but the
gesture's trailing `iframe-touchmove` postMessages are still queued; they
arrive after the unlock, their deltaX spans the whole highlight stroke →
the interceptor read them as a swipe → `beginDrag` (capture + INSTANT NAV
UNDER THE OVERLAY); the `iframe-touchend` right behind called `endDrag`
while beginDrag's capture (~34-100ms) was still in flight — endDrag read
`#active` directly, saw null, NO-OPED → setup completed into a zombie
(overlay at 0, live view already turned; next `turn()`'s `#finishActive`
disposed it = the observed self-heal). Fixes: (1) `CapturedPageTurn.endDrag`
now SERIALIZES on `#pending` like turn/beginDrag, so a release queued behind
an in-flight setup always resolves the drag (self-healing invariant);
(2) interceptor latch generalized to `gestureClaimed` — set at 'start' for
active selections AND whenever a move is blocked by `scrollLocked`, so a
gesture ever claimed by instant highlighting can never morph into a page
turn after the unlock. Tests: endDrag-race cases in
`captured-turn.browser.test.ts` (deferred capture promise + endDrag before
resolve), claim-latch cases in `useCapturedTurn-scrollLock.test.ts`.
**Lesson: postMessage-relayed touch events are task-delayed relative to the
doc's own pointer listeners — any state unlocked in pointerup is observed
UNLOCKED by the gesture's own queued trailing moves. Latch per-gesture
decisions; never trust instantaneous lock state across the relay boundary.
And any async-setup/teardown pair (beginDrag/endDrag) must serialize on the
same chain.** Known remaining gap (pre-existing): a touch gesture that ends
in `touchcancel` never dispatches interceptor 'end' (iframe relays only
touchend), which can still strand a LEGIT swipe drag until the next turn.

**Third instance (same day, iOS 18.7, INSTANT mode handle drags):** the
per-move selection gate was still beaten by a mid-drag deselect race. In
instant mode, dragging the system selection handles fires selectionchange →
`makeSelection` → Annotator's selection effect → `handleQuickAction`
('highlight' case) → `handleDismissPopupAndSelection` → `view.deselect()`
**mid-drag**; iOS then "re-confirms the native selection after our deselect"
(documented in `deferredAction.ts`). In the collapsed-selection window between
deselect and re-confirm, the interceptor's per-move gate passed and began a
scrubbed slide under the handle drag (video: partial slide held at ~20-40%,
reverted on release, selection tint visible on the incoming page = re-confirmed
selection). Fix = **gesture-start latch** in `useCapturedTurn.ts`:
`gestureHadSelection` ref set at the interceptor 'start' phase via shared
`hasActiveSelection(view)`; the `!state` move branch refuses when
`gestureHadSelection.current || hasActiveSelection(...)`. A gesture that began
with a selection stays a selection gesture for its whole lifetime.

**Companion UX fix (the user-requested half):** the reason system handles
appeared in instant mode at all — iOS WebKit's long-press text-selection
recognizer beats every JS-level suppression (inline user-select: ignored;
stylesheet user-select: kills caretRangeFromPoint on iOS; selectstart:
never fires). The working fix is NATIVE — `TextSelectionSuppressor.swift`
gates WKContentView's selection gestures while instant mode is on — see
[[instant-highlight-tap-paginate]] for the full three-attempt history. The
captured-turn latch tests live in `useCapturedTurn-scrollLock.test.ts`.
