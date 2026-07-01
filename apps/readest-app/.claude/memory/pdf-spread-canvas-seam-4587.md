---
name: pdf-spread-canvas-seam-4587
description: PDF two-page spread shows a 1px white bar at the spine on fractional devicePixelRatio (Windows 150%); canvas bitmap truncation
metadata: 
  node_type: memory
  type: project
  originSessionId: 9c176878-7bcd-4411-8c55-5ebce094a73b
---

#4587 — PDF two-page spread shows a one-pixel white bar in the MIDDLE (at the
spine) on "certain zoom levels". Repro condition = fractional devicePixelRatio
(Windows display scale 150% → dpr 1.5); at 100% (dpr 1) no bar. Fixed in
`packages/foliate-js/pdf.js` `render()`.

**Root cause:** `render()` sized the page canvas only via its bitmap
(`canvas.width = viewport.width`). `viewport.width = pageWidthCss * dpr` is
fractional, and a canvas bitmap width must be an integer, so it truncates (FP
error often drops a whole pixel: 522*1.5=783 → viewport 782.9999 → bitmap 782).
The iframe content is displayed scaled by `1/dpr` (the `documentElement`
`transform: scale(1/devicePixelRatio)`), so the truncated bitmap renders up to
~1 device px NARROWER than the page box. The left page's canvas stops short of
the spine → exposes the reader background as a thin seam (white in light
themes; in the dark demo it reads as a dark line). Right page's canvas starts
exactly at the spine, so the gap is the LEFT page's shortfall only. The element
flex boxes are always exactly adjacent (left.elR === right.elL === spine) — NOT
the source; the seam is canvas-vs-box, not box-vs-box.

**Fix:** pin an explicit CSS size to the un-truncated viewport dims so the
bitmap scales to fill the box exactly:
`canvas.style.width = `${viewport.width}px``; same for height. Display =
viewport.width/dpr = exact page box → left canvas reaches the spine. General:
fixes every page-canvas edge shortfall (single page + right page outer edge
too), all dpr/modes. Idiomatic pdf.js HiDPI pattern (bitmap=device px, CSS=
logical size) that the foliate wrapper had omitted.

**Why dpr=2 can't repro (and dpr=1.5 readily does):** equal-width spread pages
split content/2 exactly. At dpr 2, pageW*2 stays integer for even content
widths → clean. At dpr 1.5, pageW*1.5 = content*0.75 is fractional unless
content divisible by 4 → seam of 0, 0.5, or 1.0 device px depending on width.

**CDP dpr=1.5 repro recipe (no device needed):** launch a throwaway desktop
Chrome `--force-device-scale-factor=1.5 --remote-debugging-port=9444
--user-data-dir=/tmp/x`; dev-web seeds demo EPUBs in a fresh profile but no PDF
— import a sample PDF (`apps/readest-app/src/__tests__/fixtures/data/sample-alice.pdf`,
69pp US-Letter) via CDP `Page.setInterceptFileChooserDialog`+`fileChooserOpened`
→`DOM.setFileInputFiles` (the readest "Import Books" button opens a MENU; click
"From Local File" to trigger the chooser). `Browser.setWindowBounds` to sweep
ODD inner widths (1283/1284…) to hit fractional pageW. Measure left-page canvas
abs-right vs spine; capture a thin vertical clip at the spine to see the line.
Dev server picks up foliate-js edits on reload (HMR recompiled it; no restart
needed here, contra some older paginator notes). See [[issue-4112-scroll-anchoring]]
neighbors for other paginator/foliate fixes.
