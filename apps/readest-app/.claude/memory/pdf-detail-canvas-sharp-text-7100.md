---
name: pdf-detail-canvas-sharp-text-7100
description: "#7100 blurry PDF text on iOS = the #5118 mobile render budget (dpr<=2, 3.1 Mpx/page); fix = screen-sized 'detail' canvas at full dpr over the visible part of each page (foliate pdf.js). iPad-verified; foliate#144 (b8dd100) + #145 (95fa3b7, WeakRef follow-up after the merge raced the push) MERGED; readest#7300 MERGED as ba8cc0357 (2026-11-03 UTC) UNRELEASED; #7100 closed. Reporter (iPhone 3x) not yet confirmed. Worktree + all branches removed; iPad still runs the devtools test build"
metadata:
  type: project
---

#7100 (iPhone 15 Pro Max, 0.12.16): PDF text softer than Apple Books, worse when zoomed. Cause: [[pdf-ios-webcontent-oom-zoom-5118]]'s `getRenderDpr` (MAX_RENDER_DPR 2, MAX_CANVAS_PIXELS 3.1 Mpx). Measured on iPad Air 11" M2 (dpr 2, 820x1180): fit = 1.85x, 300% = 1.0x (and the floor of 1 makes that bitmap 8.3 Mpx anyway).

**Fix — foliate-js#144 (branch fix/pdf-detail-canvas, e8b1943) + readest#7300 (branch fix/pdf-sharp-text-7100, head c20ef2e47 pins foliate da95896 after CodeRabbit round 1: WeakRef docs + scroll-off test; RE-PIN to the foliate merge commit before merging #7300). Worktree `readest-fix-pdf-sharp-text-7100`:** keep the budgeted full-page base; add a detail canvas covering only the on-screen part of the page at full devicePixelRatio (pdf.js viewer's detail-view idea). Visible rect = iframe box clipped by window + every ancestor with clipping overflow (composed tree, `parentNode.host`); hidden preloaded spreads (`visibility:hidden`) get none; mid-pinch (box.width != offsetWidth) skipped. Scroll listeners on ancestors, 150 ms debounce, one pass over all docs (drops details of pages that left). Snapped to whole screen device px.
**Trap:** Readest `style.ts` sets `mix-blend-mode` on PDF canvases in override-color mode -> the coarse base shows through as a halo under the detail. Fix = base `clip-path: polygon(evenodd, page, hole)`. Device-proven (sepia + multiply, halo visible without clip).
**iPad evidence:** detail 1558x2360 at fit, 1640x2360 at 300% following pans; scrolled flow: two pages each get their visible slice; 25 page turns at 300% with no WebContent kill in syslog. Edge score (scratch sharpness.cjs, grey px per ink px) 3.64 -> 2.18 at 300%, 1.77 -> 0.87 at fit.
**Found:** iOS WebKit has NO `CanvasRenderingContext2D.filter`, so "apply theme to PDF" (`applyPageColors`) never themes pages on iOS — pre-existing, unfiled. Detail page-color rect mapping not device-tested (Android would exercise it).
Unit test: `src/__tests__/document/pdf-detail-canvas.test.ts` (3 of 5 fail without the fix).
