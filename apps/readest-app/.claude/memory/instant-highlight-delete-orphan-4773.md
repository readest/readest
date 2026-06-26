---
name: instant-highlight-delete-orphan-4773
description: Deleting a just-made highlight leaves the overlay drawn (gone only after reopen); a stale memoized annotationIndex re-draws it
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a58d242-3867-414c-869a-95a23714b361
---

#4773 (Android, instant highlight): highlight a word, delete it "within a very
short time" → the mark stays painted on the page, vanishing only after reopening
the book. Booknote IS soft-deleted (`deletedAt` set, gone on reopen) but the
**overlay was re-drawn after removal** → orphan.

**Root cause — stale memoized index re-draws a deleted annotation.**
`Annotator.tsx` re-applies per-location annotations on every relocate via the
memoized `annotationIndex` (`useMemo(buildAnnotationIndex(config.booknotes), [config.booknotes])`)
→ `selectLocationAnnotations(index, location)` → `view.addAnnotation(a)`.
`buildAnnotationIndex` filters `deletedAt` at BUILD time, but
`selectLocationAnnotations` trusted that and did NOT re-check. The delete
(`handleHighlight(false)`) stamps `existing.deletedAt = Date.now()` **in place**
on the same booknote object that's still sitting in the index bucket, and
removes the overlay (`addAnnotation(existing, true)`). If the re-apply effect
scheduled from the popup-open render flushes AFTER the delete (the "very short
time" window — passive effects deferred on Android WebView under rapid taps),
`selectLocationAnnotations` returns the now-deleted object from the pre-deletion
snapshot and `addAnnotation` re-draws it → overlay orphaned. Annotator does NOT
re-render on booknote changes (subscribes only to the stable `getConfig` fn), so
the memo stays stale until some other state change recomputes it.

NOT instant-specific in the data layer — instant highlight (`useInstantAnnotation`)
just makes it easy to hit (no popup friction, fast gesture). Delete + re-apply
(where the fix lives) is shared with normal highlights. `onCreateOverlay` reads
`getConfig` FRESH so it's safe; FoliateViewer onLoad re-draw only fires on
section load (not a quick delete).

**Fix:** re-check `deletedAt` at the READ site, not just at index build:
- `selectLocationAnnotations` (annotationIndex.ts): `if (item.deletedAt) continue;`
  before classifying — covers both the annotations and notes lists.
- The sibling `annotationIndex.globals` loop in the Annotator re-apply effect:
  `if (annotation.deletedAt) continue;` before `expandAllRenderedSections` (same
  stale-snapshot hazard for global highlights).

Test: `src/__tests__/utils/annotation-index.test.ts` — build index with a styled
note, then `highlight.deletedAt = 123` in place, assert `selectLocationAnnotations`
returns `{ annotations: [], notes: [] }` (red before fix). Verified on Xiaomi 13
Pro (fuxi, WebView) via the CDP lane: real create→delete→immediate-relocate over
4 iterations left overlay count 6→7→6 each time (no orphan); overlay-count metric
proven non-blind by a stray-overlay sanity probe. See [[android-cdp-e2e-lane]].
Related: [[instant-highlight-tap-paginate]], [[global-annotation-pageturn-perf-4575]].
