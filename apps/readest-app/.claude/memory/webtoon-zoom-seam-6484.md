---
name: webtoon-zoom-seam-6484
description: "#6484 line between zoomed images in Webtoon Mode — AA page edges over scroll bg; fix = 2-device-px overlap + drop .scroll-page overflow clip; snapping sizes does NOT work; DPR-sweep screenshot test recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 44dfcc72-14cd-4930-a818-4f13f4d304a1
  modified: 2026-09-30T06:47:10.554Z
---

#6484 (2026-09-30): Webtoon Mode (scrolled, `scroll-gap` 0) showed a thin line between
zoomed CBZ/PDF pages. Reproduces in headless Chromium at DPR 1 and 2, not just fractional.

**Cause:** page box is a fractional device-px size; each page is a scaled compositor layer
whose edge is anti-aliased against transparency, so `--scroll-bg-color` shows through.

**What did NOT work (measured, 30 zooms x DPRs):**
- Flooring page sizes to device px: fixes ~half; failures all at page tops on x.5 CSS px.
- Flooring to whole CSS px: clean at DPR 1/2, fails 14-22/30 at 1.25/1.5/1.75.
- 1-device-px overlap: faint residue (228-249 vs 255) at fractional DPRs.
- Overlap while keeping `.scroll-page { overflow: hidden }`: 2.625 still fails (the AA clip).

**Fix:** `computeScrollPageOverlap` = 2 device px when gap is 0, applied as
`--scroll-page-overlap` on `.scroll-page + .scroll-page` margin (block/inline-start),
plus removing the overflow clip. It was clean in 210/210 cases (DPR 1,1.25,1.5,1.75,2,2.625,3).
foliate#108 MERGED (db0540b), readest #6491 MERGED (d8d50f243) UNRELEASED; worktree removed. Not device-verified (WebView2/Android).

**Recipe:** `fixed-layout-webtoon-seam.browser.test.ts` screenshots with
`page.screenshot({ element, save: false })` (base64; default saves to `__screenshots__/`),
decodes via createImageBitmap, and scans a line for non-red pixels. For a DPR sweep, copy
`vitest.browser.config.mts` with a different `deviceScaleFactor` (default 2) to a temp config.
Only nearby scroll pages load lazily, so wait for load events after scrolling.
Related: spread spine seam [[paginator-scroll-fixes]] (#4857 uses the same overlap idea).
