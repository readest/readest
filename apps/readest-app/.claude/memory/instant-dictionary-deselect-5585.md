---
name: instant-dictionary-deselect-5585
description: '#5585 Instant Dictionary now deselects as the popup opens — the deliberate other side of #5213''s return-to-toolbar boundary'
metadata:
  type: project
---

**#5585** (2026-08-16): with Instant Dictionary on, dismissing the lookup popup
opened the selection toolbar. Root cause is #5213's `handleDismissPopupShowToolbar`
in `Annotator.tsx` — it returns to the toolbar whenever `isTextSelected.current`
is still true, and the in-app dictionary never deselects. On Android phones the
lookup renders as `DictionarySheet` (`innerWidth < 640`), so a backdrop tap hits
`onDismiss` and raises the toolbar — matching the report's "tap anywhere".

Fix (MERGED #5730, iOS/Android device verify pending): in `handleQuickAction`'s `case 'dictionary'`, after
`handleDictionary()`, set `isTextSelected.current = false` **then**
`view?.deselect()`. Order is load-bearing: `view.deselect()` fires a
selectionchange whose empty-selection branch in `useTextSelector` calls
`handleDismissPopup()` when the flag is still true — that would close the popup
we just opened.

Same change fixes the iOS report that the selection grabbers + blue highlight
paint **on top of** the dictionary window (WKWebView draws selection UI in a
native overlay above web content).

**Scope is the instant quick action only.** The toolbar → Dictionary path keeps
its live selection by design — that IS #5213 ("look up a word, close the popup,
then highlight or copy"). Deselecting there would revert #5213; chrox confirmed
in the issue that only Instant Dictionary should skip the toolbar. Translate /
Proofread quick actions were left alone (not reported).

Coverage is e2e, not unit: `annotation.spec.ts` "the instant dictionary drops the
selection and dismisses clean (#5585)" plus new `ReaderPage` helpers
`selectWord()`, `selectedSectionText()`, `setQuickAction()`. The quick action is
reachable from the header dropdown (`aria-label="Enable Quick Action on
Selection"` → menuitem `Instant Dictionary`); `enableAnnotationQuickActions`
defaults to true, `annotationQuickAction` to null. Mouse selections skip the
long-press gate (`isLongPressHold(0, ...)` is true), so desktop Chromium can
drive the instant path.

See [[verify-reader-chrome-needs-e2e]].
