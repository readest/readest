---
name: pdf-ios-webcontent-oom-zoom-5118
description: "iOS PDF crash #5118 = WKWebView WebContent highwater OOM (2.1 GB), page reloads not app crash; fix in foliate pdf.js render() = clamp renderDpr + render DOM at display size, over-sample only canvas bitmap (no transform/zoom); zoom breaks getBoundingClientRect"
metadata: 
  node_type: memory
  type: project
  originSessionId: 15cc3f43-25b2-456e-ae02-e6bb36e46b2f
---

# iOS PDF crash / page-reload (#5118)

**Symptom:** on iOS (native AND web build; NOT macOS) reading a PDF, the page
"closes and reloads" after turning a few pages, or IMMEDIATELY when zooming in
past ~150%. The APP does not crash; only the WKWebView WebContent process dies
and `WebViewLifecycleManager` reloads the saved URL ("WebContent process
TERMINATED! -> Recovering -> Reloading"). Repro PDF: "A Course in Rasch
Measurement Theory" (7 MB, 478 pages, mostly text, only tiny images).

**Root cause = WebContent per-process memory highwater kill.** Device crash log
(iOS 18.7.9) `JetsamEvent-*.ips`: `com.apple.WebKit.WebContent rpages 127986
reason highwater states ['active']` = **2.10 GB** (rpages x 16384-byte pages).
macOS WebKit has NO per-process ceiling, so it never triggers there; the iOS web
build shares the limit. No Sentry issue (process kill, not JS exception).

`render()` in `packages/foliate-js/pdf.js` rasterised each page at
`scale = zoom * devicePixelRatio` (dpr 3 on phones) with
`transform: scale(1/dpr)` to fit the box. Two memory bombs, BOTH iOS-only:
1. **DPR^2 bitmap/decode** — canvas bitmap + pdf.js image decode grow with dpr^2;
   dpr 3 is ~2.25x heavier than needed. (Dominates page-turn case.)
2. **compositing IOSurface** — the OLD code fit the device-res canvas into its
   box by scaling the whole `documentElement`. A `transform: scale()` is VISUAL
   only (does NOT shrink layout size): the canvas stayed laid out at
   `pageCss * zoom * renderDpr`, and WebKit backed that whole area as ONE GPU
   IOSurface (x deviceDpr). Zoom grows it quadratically -> 2.1 GB past ~150%.
   (Dominates zoom case; user's "ridiculous for a zoomed canvas" insight.)

**Fix (foliate `packages/foliate-js/pdf.js` render()) — MERGED: readest #5129
(single commit) bumping foliate to squash-merged foliate#55 = `98fc0d5` on
foliate main:**
- `getRenderDpr(page, zoom)` = `min(devicePixelRatio, MAX_RENDER_DPR=2)` then
  shrink so bitmap area <= `MAX_CANVAS_PIXELS = 2048*1536`, floor 1. (page-turn
  fix, user-confirmed.)
- **Render the DOM at DISPLAY size, over-sample only the canvas BITMAP.** Do NOT
  scale the document at all: `renderViewport = getViewport({scale: zoom*renderDpr})`
  sizes ONLY `canvas.width/height` + `page.render`; `displayViewport =
  getViewport({scale: zoom})` sizes `canvas.style`, the TextLayer, the
  AnnotationLayer and `--total-scale-factor`. The <canvas> natively downscales
  its over-sampled bitmap to its CSS box, so no `documentElement` transform/zoom
  is needed: the only GPU surface is the bitmap (clamped), and text/annotation
  layers stay in real display coordinates.
- **DEAD END that shipped briefly:** `documentElement.style.zoom = 1/renderDpr`
  DOES kill the compositing bomb (zoom scales at layout time, WebKit tiles) BUT
  breaks `getBoundingClientRect` -> text selection rects + annotation toolbar
  land in the WRONG place. The display-size render above avoids both traps.
- #4587 spread-seam preserved: `canvas.style` = un-truncated DISPLAY viewport
  (page box), so the canvas fills its box exactly regardless of bitmap
  truncation. Tests read renderDpr = `canvas.width / parseFloat(canvas.style.width)`.

**The iOS SIMULATOR CANNOT reproduce this** — it uses software compositing, so
the DPR-scaled GPU IOSurface backing is never allocated; WebContent RSS plateaus
(~470 MB dev build) and it never crashes. Only a real device shows it. Verify
rendering correctness on the sim; verify the crash/memory on device.

## On-device forensics recipe (device attached via USB, libimobiledevice)
- `idevicecrashreport -k -u <udid> <dir>` pulls crash reports (keep on device).
  Parse `JetsamEvent-*.ips` (line 1 = JSON header, rest = JSON body):
  `processes[].{name,rpages,reason,states}`; killed = reason `highwater` /
  `per-process-limit`; GB = `rpages * memoryStatus.pageSize (16384)`.
- `sudo /usr/bin/log collect --device --last 3m --output x.logarchive` right
  after repro; `/usr/bin/log show x.logarchive --predicate 'subsystem ==
  "com.bilingify.readest"'` shows the WebViewLifecycleManager reload. NOTE: the
  shell has a `log` alias -> use `/usr/bin/log`. `--last Nm` captures the last N
  min from WHEN YOU RUN IT, so reproduce then collect immediately.
- Installed dev-build app loads from the Mac dev server (`localhost:3000`), so
  foliate-js edits hot-reload without a native rebuild. Prove a foliate edit
  reaches the app by temporarily setting `MAX_RENDER_DPR = 0.5` (page goes
  visibly blurry). WebKit does NOT forward webview `console.log` to os_log.
- Inject a book without the import UI: library.json at `.../Library/Application
  Support/com.bilingify.readest/Readest/Books/`; book hash = `partialMD5(file)`
  (src/utils/md5.ts); dir `<hash>/`, file `<hash>/<makeSafeFilename(title)>.pdf`,
  minimal `config.json`.

Related: [[pdf-oom-range-flood-3470]] (Android range-flood OOM, orthogonal),
[[pdf-scroll-lag-preload-4795]] (canvas memory; DPR^2 lever flagged there),
[[crash-reporter-second-window-5052]] (Jetsam/minidump).
