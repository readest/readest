---
name: fxl-scrolled-notch-mask-edge-to-edge
description: "FXL scrolled mode clipped at camera hole - SectionInfo's scrolled-mode notch mask (notch-masked bg-base-100) occluded fixed-layout pages; skip mask for isFixedLayout (MERGED #5503)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a480314-e76b-42cd-a31e-ef4ecde17523
  modified: 2026-08-05T04:17:55.946Z
---

Fixed layout documents in scrolled mode showed an opaque texture band at the top safe-area inset (camera hole / status bar) instead of rendering edge to edge. MERGED #5503 (2026-08-05).

**Root cause:** `SectionInfo` (rendered only when Show Header is on) paints a full-cell `.notch-area` div clipped via `clip-path` to the top inset, with `notch-masked bg-base-100` added in scrolled non-vertical mode - a mask so reflowable text isn't seen clipped under the status bar. The FXL DOM underneath is already edge to edge: `foliate-fxl` host spans the full viewport and its `observedAttributes` ignore the `margin-*` attrs FoliateViewer sets (only paginator.js consumes them). FXL chrome overlays the page (`mix-blend-difference` title, #4901), so the mask wrongly occluded the document.

**Fix:** gate the mask classes on `!bookData?.isFixedLayout`; keep the transparent notch div (it is the scroll-to-top tap target). `isFixedLayout` is set atomically with `bookDoc` in readerStore, no render race.

**Xiaomi 13 device-verified** (2026-08-05): notch-area classes clean via CDP + page renders under the camera hole (both the PDF and the FRIDAY FXL EPUB). GOTCHA during verify: a concurrent session's `dev-android` installed ITS apk (same versionName) over mine seconds later - the "fix not in build" mystery was a clobbered install, not a stale bundle. Check `dumpsys package ... lastUpdateTime` against your build timestamp before debugging; also `adb input swipe` is seen as a tap by the app (no touchmove) - scroll via CDP `renderer.scrollTop` instead.

**Debug technique that cracked it:** `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + a ~30-line node ws CDP `Runtime.evaluate` script; `document.elementsFromPoint(200, 20)` listed the stack at the band and exposed `DIV.notch-area.absolute.inset-0.z-10` above `foliate-view`. Simulating the fix live (classList.remove) + screencap confirmed the visual outcome before any rebuild. Related: [[duokan-fullscreen-cover-letterbox-5263]], [[header-trigger-overlaps-text-4977]].
