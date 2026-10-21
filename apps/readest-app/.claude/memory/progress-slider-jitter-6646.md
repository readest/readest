---
name: progress-slider-jitter-6646
description: "#6646 desktop footer slider jitter: label unmounted on transient invalid progress; MERGED #6766 UNRELEASED; trigger relocate UNCONFIRMED"
metadata:
  node_type: memory
  type: project
  originSessionId: d275b68b-3397-4dd0-8f01-2777dc6eb1ee
  modified: 2026-10-13T16:07:51.533Z
---

#6646 (2026-10-13): drag the desktop footer slider past its left end and hold over the page label, and the slider jitters. Video frames showed the loop: at fraction 0 the label unmounts, the slider widens under the cursor (~2%), navigates, the label returns, and the cursor is past the left edge again.

MERGED #6766 as 7e75d60f4: PageJumpInput keeps the last committed valid page in effect-set state; DesktopFooterBar no longer gates the label on `progressValid`. CodeRabbit asks (no ref write in render, a footer-level test) both done. All CI green on 0ac36566f.

**UNCONFIRMED:** which relocate reports invalid pageinfo. Not reproducible with local books (fraction-0 relocates all valid, incl. non-linear spine[0]). Best guess: paginator emits `fraction` undefined/NaN (`#renderedPages == 0` or a size-0 page calc) → `SectionProgress.getProgress` gives NaN `current`. That NaN would also reach `readerStore.setProgress` library progress. Not on Windows/WebView2.

**Not fixed:** label width changes at digit boundaries (99 → 100) could still toggle in a narrow band; a fixed label width would change the footer look.

Related: [[paginator-scroll-fixes]]
