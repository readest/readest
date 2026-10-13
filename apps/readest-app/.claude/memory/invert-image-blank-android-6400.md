---
name: invert-image-blank-android-6400
description: "#6400 inverted images paint as a blank gap on the reporter's Android 16 phone; NOT reproducible on Xiaomi 13 in any invert/override/flow/theme combo; reporter sent an EPUB (not PDF)"
metadata:
  node_type: memory
  type: project
  originSessionId: 92f7ad1c-6113-4d47-8ea9-02e04575e12d
  modified: 2026-10-03T08:42:56.498Z
---

#6400 (closed, reporter is ujwalnk): "Images not displayed when Invert Image is enabled". The issue says PDF, but the file sent by email (2026-10-03) is an **EPUB**: Austin Kleon "Don't Call It Art". It's archived at `~/Documents/books/issues/6400/`, with an extracted copy in `x/`.

- Symptom (from the video): **scrolled mode**, pure-black theme. The image area stays blank, exactly one `.height_100_BRK` box tall (98vh). Tapping the gap still opens the image viewer, so the img is laid out but never painted.
- Markup: `div.height_100_BRK{height:98vh;page-break-before/after}` > `img.fill_height{height:100%}`, with `img{object-fit:contain;max-height:100%}`. Images are about 1645x2193 to 2000x2000 JPEGs.
- 2026-10-03 on Xiaomi 13 (Adreno, WebView 153, Readest 0.12.10): **renders correctly** with invert on and Override Book Color both on and off, in paginated and scrolled modes, on the Default and Contrast themes, and after a continuous scroll from the start of the book. Desktop Chrome renders it too. Computed style is `filter: invert(1)`, `mix-blend-mode: normal`.
- Working theory (unproven): a GPU- or WebView-specific raster drop on the reporter's device. A Mali GPU, battery saver (29% in the video) or a different WebView version are the candidates. Next step: get the device model and WebView version, and whether paginated mode shows it too.

**Why:** don't redo the whole combo matrix on the Xiaomi; it passes.
**How to apply:** if this resurfaces, test on a non-Adreno device or an emulator with SwiftShader. A <10MB copy with downscaled images (`sips -Z 800`) imports into the web dev server through Chrome file_upload plus a synthetic `drop` on `.library-page`.
