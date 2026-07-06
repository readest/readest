---
name: pdf-text-selection-fontscale-4480
description: PDF text selection/highlight misplaced (into margins, offset down) when OS font-size accessibility scaling is on
metadata:
  type: project
---

**Issue #4480**: on some Android devices PDF text selection/highlight is misplaced — the blue selection rectangles bleed into the blank page margins and sit ~1/3 line too low. Reported on a Galaxy Tab A8; NOT reproducible on a Galaxy S21.

**Root cause (NOT what it looked like):** it is the **OS accessibility "font size" setting** (Android Settings > Display > Font size, `settings put system font_scale 1.3`), not the WebView version or devicePixelRatio. The OS font scale multiplies every piece of WebView-rendered *text* — including the transparent pdf.js text layer used for selection/highlight — but leaves the *canvas* page bitmap untouched. So the text-layer spans end up `fontScale`x larger than the glyphs baked into the canvas, and the native `::selection` boxes (which follow the span boxes) overshoot the text horizontally and vertically. The Tab A8 (a tablet) had enlarged system fonts; the S21 did not.

**Ruled out during investigation:** WebView version (Tab A8 was on WebView **148**, newer than the working S21's 147 and a WebView-124 emulator — all fine at default font scale); devicePixelRatio (the paginator's fit-width `zoom` keeps `--total-scale-factor` DPR-invariant); interactive-vs-programmatic selection (both fine). Font-metric/realm mismatch was a red herring: main-app-doc and iframe-doc `measureText` are identical on working devices.

**Fix** (`packages/foliate-js/pdf.js`, `render()`): detect the OS font scale with a probe (`offsetHeight` of a `100px`/`line-height:1` box = `100 * fontScale`, unaffected by DPR or the `<html>` `scale(1/dpr)` transform) and divide it back out: `--total-scale-factor = scale / getFontScale(doc)`. Positions (`left`/`top`) are px and font-scale-independent, so only font-size needs correcting. At font_scale 1.0 the probe returns 1.0 → no change (no regression). PDF-only; EPUB is unaffected because its text and overlay scale together.

**Repro/verify harness (reusable):** the release APK's WebView is CDP-debuggable. `adb forward tcp:PORT localabstract:webview_devtools_remote_$(pidof com.bilingify.readest)`, then drive `Runtime.evaluate` over the page WebSocket. The PDF renders in an iframe nested inside foliate-view's shadow DOM — deep-traverse `shadowRoot` + `iframe.contentDocument` to reach `.textLayer`. Create a multi-line selection with `doc.getSelection().addRange()` + `adb exec-out screencap` to see the native highlight. Set `settings put system font_scale 1.3` to reproduce. See [[android-cdp-e2e-lane]].

Related PDF text-layer notes: [[pdf-spread-canvas-seam-4587]] (the `--total-scale-factor` / canvas-size line this fix touches), [[overlayer-splitrange-textnodes]].
