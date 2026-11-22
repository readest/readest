---
name: webkit-svg-filter-same-document-only
description: "WebKit ignores CSS filter: url(data:...#id) / external SVG filters; it looks #id up in the current document. Chromium-only CI can't catch it (#7391, MERGED #7724)"
metadata:
  node_type: memory
  type: project
  originSessionId: 72298d27-adc8-4f6d-aa57-b3f9cf32dd1b
  modified: 2026-11-21T04:58:15.846Z
---

WebKit (iOS, iPadOS, macOS WKWebView; desktop WebKit 16.4 through current) never loads an SVG filter from another document. `filter: url("data:image/svg+xml,...#id")` resolves `#id` against the document that uses it; with no such element, the image draws unfiltered. Chromium loads the data URL, so the setting worked on Android, Windows, Linux and web, and broke only the Apple apps (#7391, #7394).

Fix (#7724, 6b1c5057a): `mountWhiteTransparencyFilter(doc)` in `src/utils/imageBackground.ts` puts the `<filter>` in each document's `<head>` (body child indices, which CFIs count, unchanged); the CSS uses `url(#readest-white-transparent)`. Mounted on section load, footnote popup load and in the top-level document for ImageViewer.

**Why:** #7270 shipped the feature verified only in Chromium/CEF ("WebKit could not launch").

**How to apply:**
- Any new SVG filter/mask/clip-path referenced from CSS must live in the same document that uses it.
- Ad-hoc WebKit checks: a stray same-id element in the test page makes the data URL look like it works. Test with the definition absent.
- Run a browser test under WebKit locally with a temp config: `mergeConfig(base, { test: { browser: { instances: [{ browser: 'webkit' }] } } })` from `vitest.browser.config.mts`. WebKit lacks canvas `ctx.filter`, so those two existing tests always fail there.

iPad repro recipe that worked: copy the EPUB with `devicectl device copy to --domain-type appDataContainer ... Documents/x.epub`, then `devicectl device process launch --payload-url file://<Documents path from plugin:path|resolve_directory {directory:6}>/x.epub` imports and opens it. Change per-book view settings by editing `Books/<hash>/config.json` (pull, edit, push, relaunch), then navigate via the inspector `location.href='/reader?ids=<hash>'`. A per-book texture (`backgroundTextureId: 'parchment'`, opacity 1) makes transparency visible without touching global theme settings. See [[ios-device-screenshot-and-install-recipe]], [[ios16-safari-layout-repro-old-webkit]].
