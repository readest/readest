---
name: localecompare-options-collator-perf
description: "localeCompare with an options object (e.g. {numeric:true}) builds a new collator per call; ~20x slower in V8 — cache an Intl.Collator in sort comparators"
metadata:
  node_type: memory
  type: project
  originSessionId: 1db44bf6-7fe8-40a9-aece-dd70266a70bc
  modified: 2026-10-10T00:55:43.678Z
---

`a.localeCompare(b, locale, { numeric: true })` skips V8's cached collator and builds a new ICU collator on every call. Benchmarked 2026-10-10 sorting 10k titles: V8 20ms (no options) → 397ms (with options); a cached `Intl.Collator` 26ms. JSC (iOS/macOS) was already 602ms for plain `localeCompare`, 760ms with options, 29ms with a cached collator — so caching wins on every platform.

PR #6693 (natural title sort, closes #6692) MERGED with a maintainer follow-up commit adding `compareTitles` in `src/app/library/utils/libraryUtils.ts`: one numeric `Intl.Collator` cached per locale, used by `compareBookByKey` (Title) and `compareSortValues` (sortBy Title). A test spies on `String.prototype.localeCompare` to guard the regression.

Still open: Series sort compares series names with plain `localeCompare`, so "Series 10" sorts before "Series 2". Author/Format/Series sorting in the library also still use per-call `localeCompare`, which is slow on JSC.

**Why:** library sorts run once per shelf in `evaluateBookshelves` (Bookshelf.tsx), so a slow comparator gets multiplied on large libraries and slow Android devices.

**How to apply:** in any hot comparator, never pass an options object to `localeCompare`; hoist or cache an `Intl.Collator`. Also see [[cbz-split-folder-page-order-5745]] (numeric collator for paths).
