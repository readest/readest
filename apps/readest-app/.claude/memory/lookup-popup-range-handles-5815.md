---
name: lookup-popup-range-handles-5815
description: "#5815 \"selection markers on top of the dictionary popup\" were Readest's own range-editor handles (Instant Highlight / highlight tap), not Android's native handles; fix gates both range editors on no lookup popup open"
metadata: 
  node_type: memory
  type: project
  originSessionId: efff0130-372f-4cb9-86b3-0918e9e615f2
  modified: 2026-08-22T18:44:37.461Z
---

**#5815** (2026-08-21, Android 14, 0.12.1): "word selection markers remain
visible on top of the dictionary popup". Branch `fix/lookup-popup-range-handles-5815`
(worktree removed after merge),
commit `29ac95c46`, PR #5829 MERGED 2026-08-23 (see [[reader-feature-fixes]] for
merge state).

**Root cause (device-confirmed):** the markers are the app-drawn handles of
`AnnotationRangeEditor` / `SelectionRangeEditor` (`fixed inset-0 z-50`,
rendered after the lookup popups in `Annotator.tsx`), which stay mounted
whenever `editingAnnotation` (Instant Highlight hold, tap on an existing
highlight) or `selection.handlesSuppressed` (#1553 hyphen path) is set.
Reporter uses Instant Highlight (#5429). Native Android handles are NOT the
cause on a current WebView: tapping the toolbar button (parent doc) or the
sheet `Dialog`'s `focus()` moves frame focus to the parent and Chromium
clears the composited selection, so they vanish (selection paints grey).
The toolbar -> Dictionary path keeps the selection live by design (#5213).

**Fix:** `const lookupPopupOpen = showDictionaryPopup || showDeepLPopup ||
showProofreadPopup;` gates both editors. They return with the toolbar
(#5213 dismiss) or go with the full dismiss. `Handle` got
`data-testid='selection-handle'`; e2e `annotation.spec.ts` "hides the
range-edit handles while the dictionary popup is open (#5815)" with new
`ReaderPage.clickHighlight()` (dispatches a click inside the section doc at
the overlay path's top-left; the Readest foliate fork draws highlights as a
merged `<path>`, not `<rect>`s, and `selectText()` selects in a prerendered
section that may be off screen) and `rangeHandles` locator.

**Verified on Xiaomi 13** (Android 16, APK md5 matched): highlight tap ->
Dictionary = sheet with no handles (before: two yellow teardrops over the
sheet); Instant Highlight hold -> Dictionary = same; long-press selection ->
Dictionary -> dismiss returns the toolbar with the selection.

**Open / not done:** native handles on older WebViews unverified (no repro
here); `androidSelectionHandlerHeight` in Annotator is 0 so anchored popups
placed below a selection could touch native handles; hiding the editors also
applies to Translate/Proofread popups (consistent, untested by reporter).

**Recipes learned:** CDP `Input.dispatchTouchEvent` long-press = plain tap
(no gesture provider) -> use `Input.synthesizeTapGesture {duration:800}`
for native long-press selection; the Instant Highlight hold only engaged via
a real MotionEvent (`adb shell input swipe x y x y 900`); `adb shell wm
density 240` flips the phone into the anchored-popup layout (`wm density
reset`, relaunch via `readest://book/<hash>`; Back key on the reader exits
the app). Local Playwright: `next dev` overlay blocks clicks, so run `pnpm
build-web` + `pnpm start-web -p 3100` from the worktree behind a scratch
config; an Android build in the same worktree clobbers `.next` and kills the
e2e server. `pnpm dev-android` from a fresh worktree took ~6 min (cargo
cache shared). See [[feedback-always-verify-on-xiaomi]],
[[instant-dictionary-deselect-5585]].


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5815 markers over the dictionary sheet](lookup-popup-range-handles-5815.md) MERGED #5829; markers = app-drawn range-editor handles (Instant Highlight / highlight tap), NOT native; gated on `lookupPopupOpen`; Xiaomi verified; CDP long-press = `synthesizeTapGesture`, instant hold needs `adb input swipe`
