---
name: image-viewer-fit-relative-zoom-5362
description: "#5362 image viewer clarity varies per device; zoom % was fit-relative, not resolution-relative; will-change does NOT pin raster scale"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf416a2b-d88f-4c44-85a4-b817bd5c0b57
  modified: 2026-07-27T15:11:25.950Z
---

#5362: illustrations looked softer in Readest than the same file extracted and
opened in an external viewer, and clarity differed per device at the same
reported zoom. MERGED PR #5365 (2026-07-27).

Root cause was arithmetic, not rendering. `ImageViewer` lays the image out with
`maxWidth/maxHeight: 100%` and printed `scale * 100` as the badge, but `scale`
is relative to the **fit-to-screen** size. Fit size and DPR both differ per
device, so "100%" meant a different real magnification everywhere. Measured for
a 1600x2400 illustration: 0.43 device px per image px on 1080p desktop, 0.52 on
iPhone XR, 0.76 on a DPR 3 phone, vs 1.00 in an external viewer.

Fix: measure `pixelPerfectScale = naturalWidth / (offsetWidth * dpr)` and report
zoom against it, so 100% = one image px per device px. `offsetWidth` is the
laid-out width and stays the fit size under the zoom transform, which is why it
works at any zoom (verified in a real browser; jsdom fakes it). Double-click
snaps to 1:1 because multiplicative 1.2x steps can never land on 100%, and
`MAX_SCALE` being fit-relative could leave the ceiling below 1:1 for images more
than 8x the fit size.

**Two dead ends, both disproven -- do not re-investigate:**

- `convertBlobUrlToDataUrl` (`src/libs/document.ts`) is byte-exact:
  `FileReader.readAsDataURL` on the raw blob, no canvas, no re-encode. Nothing is
  lost in decoding. (Contrast `fetchImageAsBase64` / `processDiscordCover` in
  `src/utils/image.ts`, which DO downscale and re-encode.)
- `will-change: transform` (added by #4465 for pan flicker) does **not** pin the
  compositor raster scale in Chromium. At `scale(6)` a 1px grating resolves
  identically with and without the hint. Full detail is recoverable by zooming.
  Caveat when testing this: DevTools/CDP screenshot capture re-renders the page,
  which erases exactly the compositor staleness you would be testing for -- use a
  real OS screen capture, or a discriminating in-page test.

Corollary: super-resolution is the wrong tool for "blurry image" reports here.
The default view *downscales*, so there is no missing detail to reconstruct, and
invented detail is a visible defect on line art and text-bearing illustrations.

`TableViewer` carries the same `Math.round((scale * 100) / 5) * 5` badge but
scales HTML, which is resolution-independent, so fit-relative is correct there.

Related: [[image-zoom-trackpad-flicker-4742]], [[pdf-blurry-desktop-dpr-clamp-5251]]
