---
name: annotator-overlay-z-layers
description: "Reader overlay stacking — range handles vs popups/sheets/selection toolbar; why #5815 existed, the z-[44]/z-[43] bands, and why iOS native handles can't be stacked at all"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6cadaf05-b000-4043-9a4e-aaafa0fab6f6
  modified: 2026-09-03T00:00:00.000Z
---

The reader's overlays all sat at **z-50 in one stacking context**, so the tie
broke on **DOM order** — and `SelectionRangeEditor` / `AnnotationRangeEditor`
(`fixed inset-0`) render *after* the popups in `Annotator`'s JSX. Their handles
therefore drew on top of the dictionary, the translator and (once it existed)
the note-editor sheet. That is the whole reason #5815 exists: it worked around
the stacking by *unmounting* the range editors while a lookup popup is open
(`lookupPopupOpen`, now `overlaySurfaceOpen`).

**Layers now (#6013, then the toolbar band below it: MERGED #6036 = 88ea2de55):**

| layer | z |
|---|---|
| paragraph overlay, TTS mini player | `z-40` |
| **annotation/selection toolbar (`AnnotationPopup`)** | **`z-[43]`** |
| **range-edit handles** | **`z-[44]`** |
| sidebar / notebook panel + their dismiss overlay | `z-[45]` |
| every other `Popup` container + triangle, `Dialog`/sheets | `z-50` |

**The selection toolbar is the one surface that must sit BELOW the handles.**
It opens *against* the selection, which is exactly where the end handle's stem
and ball hang, so the two overlap by design and whichever layer wins owns those
pixels. #6013 demoted the handle layer from z-50 to `z-[44]` and left
`.selection-popup` at z-50, so the toolbar swallowed the bottom ~17px of the end
handle: `elementFromPoint` at the drag test's grab point resolved to
`DIV.selection-buttons`. The covered part of the handle stopped dragging and
fired whichever tool button it landed on. Fix = wrap `AnnotationPopup`'s `Popup`
in `<div className='pointer-events-none fixed inset-0 z-[43]'>`. `fixed inset-0`
makes the stacking context **without moving the popup** (its padding box is the
viewport, so the absolutely-positioned `Popup` keeps its exact coordinates);
`pointer-events-none` keeps the full-screen wrapper from eating the outside taps
that dismiss it, and the `Popup` re-arms with `pointer-events-auto`.

**How to apply:** never add a reader overlay at `z-50` and rely on render order.
If handles appear over a new surface, fix the layer — don't add another unmount
gate. Regression tests:
- `e2e/tests/annotation.spec.ts` › "draws the range-edit handles above the
  selection toolbar" reads all three layers' **computed** z-index off the live
  DOM (not class names) and pins `toolbar < handles < popup layer`.
- `src/__tests__/android/selection.android.test.ts` › "keeps the annotation
  toolbar out of the handles grab area" hit-tests the overlap itself with
  `elementFromPoint` on 5 points per handle, with a premise guard asserting the
  boxes actually overlap. The **web lane cannot** host that hit test:
  `clickHighlight()` puts the AnnotationRangeEditor handles far off-viewport
  (x = -3762 at 1280x720), so overlap is always 0 there.

`z-[44]`/`z-[43]` do emit CSS under Tailwind 4 here (`z-[45]` was already in
use), unlike the `p-[Npx]` trap in [[daisyui-v5-tailwind-v4-migration]].

**iOS native selection UI cannot be stacked at all.** The grabbers and the
callout bar are UIKit views WebKit composites above the entire web layer — not
in the DOM, so no z-index reaches them. (The selection *highlight* is painted in
the content layer, so a z-50 popup does cover that.) Two levers only:
1. Clear the selection — [[annotations-hub-scroll-to-new-note-5987-5957]]; but
   that breaks #5213 for the toolbar lookups.
2. Make WebKit stop drawing the grabbers while keeping the selection —
   **this is what ships**: `useTextSelector.suppressNativeSelectionHandles()`
   (exported; mobile-only) empties the selection for one painted frame, then
   re-adds the same range programmatically. The engine only draws grabbers for
   a *user-initiated* selection, so they stay gone; `handlesSuppressed` hands
   over to the app's handles. Called from the dictionary / translator /
   proofread openers. It generalises `suppressNativeHandlesForPages()`, which
   stays gated on `crossPageEnabled()` (`isFixedLayout && scrolled`) for the
   Android cross-page case (#5809). Keeps `guardProgrammaticSelection` so the
   selectionchange it fires can't dismiss the popup being opened, and bails if
   a competing gesture re-selects during the empty frame.
   Tests: `useTextSelector-nativeHandles.test.ts` (mutation-checked).
   **NOT verified on an iOS device — still open at merge.**

**Do not "fix" handle overlap by dropping the selection.** #5213 (e2e-covered)
requires a toolbar-invoked dictionary/translator/proofread lookup to keep its
selection so dismissing it returns to the selection toolbar; #5585 is the
deliberate exception for the *instant* lookup. Only the note editor consumes its
selection.
