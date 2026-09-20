---
name: instant-lookup-restore-selection-6213
description: "#6213 instant dictionary left nothing selected — restore on dismiss; the trap is handleHighlight's republish re-firing the quick action"
metadata:
  type: project
---

**#6213** MERGED #6272 (54e80d28d, 2026-09-18); worktree removed. With Instant Dictionary on,
closing the lookup left nothing selected, and re-selecting the word only re-opened the
dictionary — so the word could never be highlighted or copied.

**Cause = 07306093e (#5730, closes #5585)**, which added `isTextSelected.current = false;
view?.deselect()` to the instant-dictionary branch of `handleQuickAction`. chrox's call
(asked, answered): **always restore + show the toolbar, no setting** — #5585 wanted the
opposite (clean dismiss, no menu) and loses.

**Fix.** `useTextSelector.restoreSelectionRange(range)` (exported) re-adds the range under
`guardProgrammaticSelection` and sets `isTextSelected.current = true`. It must **not** call
`setSelection` — a new selection object re-runs Annotator's `[selection]` effect. Annotator
sets `instantLookupDeselectedRef` when it deselects and consumes it at the top of
`handleDismissPopupShowToolbar`. The deselect *while the popup is open* is untouched.

**The trap that only the device caught.** `handleHighlight` ends with
`setSelection({ ...selection, cfi, annotated: true })`. With the selection restored
(`isTextSelected` true) and a quick action armed, the effect read that as a **fresh**
selection and re-opened the dictionary: tapping a highlight colour on the handed-back word
bounced straight back into the lookup. The once-per-gesture `fired` latch
(`deferredAction.ts`) does **not** save you — on Android MainActivity bridges every touch on
the *window*, so the tap on Readest's own toolbar calls `beginGesture` and re-arms it.
Fix = `quickActionHandled?: boolean` on `TextSelection`, stamped on the handed-back
selection, checked in the effect's quick-action branch. It rides along through `{...selection}`
republishes and is absent on genuinely new selections, so nothing leaks.

Rejected: keying the skip on `Range` identity — `sel.getRangeAt(0)` returns the **live**
range, so a drag-extended selection would reuse the same object and get skipped.

**jsdom reproduction needs the gesture re-arm.** A plain republish in
`AnnotatorLookupSurfaces.test.tsx` passes even without the guard (the latch eats it). The
test must first drive `foliateHandlers['onLoad']` (that is what registers the pointerdown
listener) and then dispatch a `pointerdown` with `pointerType: 'mouse'` — a bare
`new Event('pointerdown')` sets `pointerDownTimeRef = Date.now()` and `isLongPressHold`
then returns false, which hides the bug a second way.

**Xiaomi 13 VERIFIED** (dev-android build): sheet opens with no grabbers/system menu over
it; dismiss gives back selection + app handles + toolbar; Copy spends it; Highlight applies
and does not re-open the lookup; a fresh long-press still fires the quick action.
Left behind: **two yellow test highlights** in *The Sense of Style*, Prologue p.10
("derided", "vaunted") — toolbar toggle-off via adb taps did not remove them.

Note the selection highlight (not the grabbers) **is** visible under the sheet on Android:
`suppressNativeSelectionHandles` re-adds the range 2 rAF after emptying it, for every lookup
route. Pre-existing, not from this change.

See [[lookup-surface-flash-suppress-handles-6013]], [[annotator-overlay-z-layers]],
[[one-tap-highlight-5983]].
