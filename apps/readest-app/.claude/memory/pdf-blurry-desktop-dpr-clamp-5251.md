---
name: pdf-blurry-desktop-dpr-clamp-5251
description: "#5251 blurry PDF text in 0.11.20 = the #5118 iOS memory clamp applied on desktop; MAX_CANVAS_PIXELS (3.1 Mpx) is tiny next to a desktop window so renderDpr fell to ~1.25 on a dpr-2 screen; fix = budget only on mobile WebViews (UA sniff in foliate pdf.js)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a31470c5-bfca-4764-832f-77b752462c50
  modified: 2026-07-26T15:26:34.912Z
---

# PDF text blurry on desktop since 0.11.20 (#5251)

**Symptom:** PDF glyph edges look soft/blurry in 0.11.20, sharp in 0.11.18
(Windows 11 report, but it hits every desktop). Contrast setting doesn't help.

**Root cause:** the iOS memory budget from [[pdf-ios-webcontent-oom-zoom-5118]]
(foliate `98fc0d5` / readest #5129, first tagged in **v0.11.20**) was applied on
every platform. `getRenderDpr()` capped the page bitmap at
`MAX_CANVAS_PIXELS = 2048*1536` (3.1 Mpx) — a mobile-sized budget. A PDF page
fitted to a desktop window blows straight past it, so the render dpr collapses:
measured live on a dpr-2 Mac (`localhost:3000` reader, fit-width zoom 2.37,
CSS box 1280x1578.67) the bitmap was **1597x1969 = renderDpr 1.248** where
0.11.18 rendered 2560x3157 at the full dpr. The canvas then upscales its raster
into the CSS box -> blurry text. Nothing to do with contrast or the text layer.

**Fix (foliate#62 = `df623db` on foliate main, MERGED; readest PR #5348 bumps the
submodule + tests):** gate the budget on mobile WebViews only — desktop browsers
have no per-process memory ceiling, which was always the premise of #5118.

```js
const isMobileWebView = () => {
    const ua = navigator.userAgent
    return /Android|iPhone|iPad|iPod/i.test(ua)
        || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)  // iPadOS = desktop UA
}
// getRenderDpr: dpr = devicePixelRatio; only clamp (MAX_RENDER_DPR + area budget) when mobile
```

Windows touch laptops stay "desktop" (UA is `Windows NT`, not `Macintosh`).

**Debug recipe (measure renderDpr live, no devtools):** walk shadow roots for
iframes, then `canvas.width / parseFloat(canvas.style.width)` — the CSS box is
the display size and the bitmap is the over-sampled one, so that ratio IS the
render dpr. Compare against `devicePixelRatio`; anything below it = upscaled =
blurry.

**Still open:** mobile keeps the 3.1 Mpx budget, so an **iPad at default zoom**
also renders below its dpr (1024x1366 page at dpr 2 -> renderDpr ~1.5). Raising
or dropping the mobile budget needs on-device verification (the simulator cannot
reproduce the #5118 OOM). Note the biggest #5118 lever — the whole-document
`transform: scale()` IOSurface — is gone regardless, so the mobile budget is
probably more conservative than it needs to be.

Tests: `src/__tests__/document/pdf-canvas-memory-cap.test.ts` stubs
`navigator.userAgent` / `maxTouchPoints` per case (desktop = full dpr, iPhone /
iPad = clamped).
