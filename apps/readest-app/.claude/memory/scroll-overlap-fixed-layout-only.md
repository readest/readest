---
name: scroll-overlap-fixed-layout-only
description: "Scroll \"Overlap Pixels\" is now PDF/fixed-layout only (chrox decision 2026-10-04); EPUB line-snap overrode it; plus two measurement traps that faked a PDF bug"
metadata:
  node_type: memory
  type: project
  originSessionId: ea7d14b6-ba4c-4a36-a3d6-89d1b4ff0971
  modified: 2026-10-04T05:51:01.604Z
---

Scrolled-mode "Overlap Pixels" was dead for EPUB since #4358 (line-aware reading ruler): `snapScrolledDistanceToLines` snaps to the first line cut at the FULL viewport edge, discarding `size - overlap`. Device steps with overlap 100 on a 785px view: 685/767/780 (685 = snap fallback). PDF honours it exactly (773 = 873-100 on Xiaomi): fixed-layout has no `#container`, so the snap falls back to the raw distance.

chrox decided (2026-10-04): line snapping already keeps cut lines, so hide the row for reflowable and apply overlap only when `rendition.layout === 'pre-paginated'` (usePagination + useTTSControl; ControlPanel row gated on `bookData.isFixedLayout`). MERGED #6621 (618db215d) UNRELEASED, Chrome + Xiaomi verified; same PR tidied the fixed-layout View menu (no Paragraph/Speed Reading, "Apply Theme Colors" after Auto Scroll, Webtoon Mode in its own group above sync). Worktree + branch removed.

**Why:** avoid re-investigating a phantom PDF bug.
**How to apply — traps that made PDF look broken:**
- A `scrollBy` wrapper that forwards `(o, y)` with `y === undefined` selects the `(x, y)` overload → scrolls by NaN = 0. Forward `...arguments` or only `o`.
- A Chrome-extension tab behind the user's active tab is `visibilityState: hidden`: native `behavior:'smooth'` scrolls never advance and setTimeout throttles (CDP evals time out). The EPUB paginator's own animation still moves. Measure smooth scrolling on the device via CDP instead (see [[cdp-android-webview-profiling]]).
- Tapping Alice at (1100,600) in Chrome hits a highlight and opens the annotation popup instead of turning.
