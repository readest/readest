---
name: lookup-surface-flash-suppress-handles-6013
description: Dictionary/Translate/Proofread surfaces flashed open then vanished on mobile - suppressNativeSelectionHandles republishes the selection and Annotator answers it with the toolbar
metadata:
  type: project
---

Regression introduced by **6df90139d (#6013, merged 2026-09-01)**, found while verifying
#6018 on Android. Tap Dictionary on a selection -> the sheet paints for ~16 ms and closes.
`git log -S "suppressNativeSelectionHandles" -- .../Annotator.tsx` returns that commit only.

**The loop.** `handleDictionary` / `handleTranslation` / `handleProofread` all call
`suppressNativeSelectionHandles()` (`useTextSelector.ts`), whose last statement is
`setSelection((prev) => ({ ...prev, handlesSuppressed: true }))`. That is a **new object**,
so Annotator's `useEffect(..., [selection, bookKey])` cannot tell it from a fresh user
selection and answers with `handleShowAnnotPopup()`, which does `setShowDictionaryPopup(false)`.
The surface closes itself on the frame it opened.

Device trace (Xiaomi 13, CDP MutationObserver + patched `Selection.prototype`):
```
6:click  7:sel.removeAllRanges  8:added DIALOG#dialog.modal...z-50
9:sel.addRange txt=fortune  10:iframe.selectionchange  11:removed DIALOG...
```
add t=62557 -> remove t=62573. No intervening pointer event, app pid stable, no console
error: not a crash, not the Dialog's own Escape/back/overlay/drag-end paths, and not the
guarded `selectionchange` (`releaseProgrammaticSelection`'s 150 ms trailing timeout eats it).

**Fix** (one guard, top of that effect, after `setTrianglePosition`):
`if (showDictionaryPopup || showDeepLPopup || showProofreadPopup) return;`
Safe because nothing can select new text while one of these is up - they all cover the page.

Tests: `src/__tests__/components/annotator/AnnotatorLookupSurfaces.test.tsx`, one per
surface, driving `h.setSelection((prev) => ({ ...prev, handlesSuppressed: true }))` exactly
as the hook does. The harness needs the `@/utils/sel` mock **and** a `#gridcell-book-1`
element or the effect early-returns on a zero rect in jsdom (copied from
`AnnotateNoteEditorFlow.test.tsx`).

Device-verified twice on the rebuilt APK: dialog added, never removed.

MERGED #6022 (7413386ce) 2026-09-02, split out from the #6018 work.

See [[annotator-overlay-z-layers]], [[annotations-hub-scroll-to-new-note-5987-5957]],
[[mdict-audio-pos-image-6018]].
