---
name: fixed-layout-pageinfo-is-location
description: "progress.pageinfo is a 1500-unit location counter, not a page index; fixed layout must use progress.section"
metadata:
  node_type: memory
  type: project
  originSessionId: cb51df53-15ef-424f-9bd4-07f9f549b5d5
  modified: 2026-10-10T03:28:13.066Z
---

`progress.pageinfo.current` comes from foliate's SectionProgress `location` (sizePerLoc 1500).
PDF sections are size 1000, so pageinfo ≈ ⅔ × page index and adjacent PDF pages collide
(pages 0 and 1 both → 0). The codebase uses `isFixedLayout ? section : pageinfo` everywhere
(`readerStore.ts` setProgress, ProgressBar, PageNavigationButtons).

**Why:** PR #6674 keyed PDF ink by `pageinfo.current`, so ink showed on the neighbouring page and the
notebook's "Page N" jumped to the wrong page.

**How to apply:** any per-page feature on fixed layout → `progress.section.current` (spine index,
what `view.goTo(n)` expects). See [[boox-pen-sdk-build-gotchas]].
