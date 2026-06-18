---
name: ios-instant-dict-double-popup
description: iOS instant system-dictionary fired 2-3× per long-press + tap-to-deselect re-opened it + Word Lens ignored system dict; deferredAction once-per-gesture latch + long-press-hold gate
metadata: 
  node_type: memory
  type: project
  originSessionId: 1c09f918-0b1d-4f75-b1c6-8cef5eb73d60
---

Three related instant-dictionary bugs fixed together (dev branch, 2026-06-18). Core: the **instant quick action** (Annotator effect `[selection,bookKey]` → `handleQuickAction`) fired per `selectionchange`, and **iOS emits MULTIPLE `selectionchange` for one long-press** (user log showed 3; Android emits 1). Each fire → `handleDictionary` (system path) → `invokeSystemDictionary` → native `show_lookup_popover` which drills to the top-most presented VC and stacks another `UIReferenceLibraryViewController` → 2-3 sheets. Android never hit it because it **defers the action to `touchend`** (coalesces); iOS fired immediately.

**Fix 1 (double/triple sheet)** — `src/app/reader/utils/deferredAction.ts`: added a `fired` latch so `runOrDeferAction`/`flushDeferredAction` run the action **at most once per gesture**; `beginGesture(state)` (clears pending + re-arms) called at gesture start — Android **native** `touchstart` (replaced `cancelDeferredAction`) and a NEW **non-Android DOM `pointerdown`** listener in `Annotator.tsx` (gated `!isAndroidApp`; Android keeps its native path).

**Fix 2 (tap-to-deselect re-opened dict ~1/3)** — after dismissing the sheet iOS leaves the word selected; the reselection is safe (latch still set, no WebView pointerdown from the modal swipe), but tapping outside to deselect IS a pointerdown → `beginGesture` re-armed the latch, then a racy `selectionchange` re-reported the lingering word before collapse → re-fired. Fix = `isLongPressHold(pointerDownTime, now, 300ms)` gate in `handleQuickAction` (gated `!isAndroidApp`): only fire from a long-press hold (iOS selection appears ~500ms after pointerdown; tap-stray fires ~tens of ms). Touch pointerdown time recorded in the non-Android listener; **mouse records 0 → bypasses the gate** (desktop selects on pointerup).

**Fix 3 (Word Lens ignored system dict)** — Annotator effect `wantWordLensDict` branch hardcoded `setShowDictionaryPopup(true)`; changed to call `handleDictionary()` (which checks `isSystemDictionaryEnabled` → `invokeSystemDictionary`, else in-app popup), same as the toolbar/instant paths. See [[wordlens-feature]].

Verified on Xiaomi 13 Pro via CDP+adb (`src/__tests__/android/helpers/*`): real system-dict path on Android = `ACTION_PROCESS_TEXT`→Eudic; instant dict fired once/long-press + re-armed gesture 2; gloss tap → `handleDictionary system=true`+`invokeSystemDictionary os=android`. iOS confirmed by user. Gotchas: `longPressWord` waits for a persistent selection → times out in instant-action mode (the action dismisses the selection); count fires via a `console.info` hook read over CDP `evaluate` instead. `openFixtureBook`'s >200-char gate fails when the fixture's saved progress lands on the sparse feedbooks end-page → connect to the already-open reader instead.
