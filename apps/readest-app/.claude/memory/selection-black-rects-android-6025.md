---
name: selection-black-rects-android-6025
description: "Issue #6025 black rectangles during Android text selection - reporter is on a Samsung Galaxy A26 5G (Mali-G68); NOT reproducible on Xiaomi/Adreno across WebView 152/153/154; failure follows Android's PixelCopy-backed selection magnifier"
metadata: 
  node_type: memory
  type: project
  originSessionId: f38e9e41-eed1-42f7-a86b-175489d870bb
  modified: 2026-09-03T05:30:00.000Z
---

Issue #6025 ("Black rectangles during selection on some Android devices", reporter `natewind`,
Android 16, WebView **153.0.8010.11**, Readest 0.12.6). Investigated 2026-09-03. **NOT reproduced
on the Xiaomi, but the reporter's device is now identified exactly.**

## Reporter device recovered from the uploaded MP4

The light-theme attachment contains Samsung's private MP4 metadata, even though the issue form did
not ask for the phone model:

- `mdlnSM-A266B`
- `com.samsung.android.utc_offset=+0400`
- `Samsung_Capture_Info=Screen recording`
- encoded dimensions `1080x2340`, matching the physical display

`SM-A266B` is a **Samsung Galaxy A26 5G**. Public Vulkan results for the same model/Android 16 report
an **ARM Mali-G68** GPU. This is the important hardware boundary: the clean Xiaomi 13 is
Snapdragon/Adreno, so its negative result does not clear the Samsung/Exynos/Mali path.

Sources:

- Samsung model page: https://www.samsung.com/es/support/model/SM-A266BLGBEUB/
- Samsung dimensions/specification page: https://www.samsung.com/au/smartphones/galaxy-a/galaxy-a26-5g-black-128gb-sm-a266bzkdxsa/
- Same-model Vulkan result: https://browser.geekbench.com/v6/compute/5444469

## What the reporter's two videos actually show (frame-level analysis)

Measured pixels, light-theme video, good frame vs broken frame at the same coords:

| sample | good | broken |
|---|---|---|
| page background | `#e9e9e9` | `#000000` |
| body glyph | `#161616` | `#222222` (unchanged) |
| popup toolbar | `#e9e9e9` | `#d7d7d7` (still painted) |

So the failure is **"the background stops painting" while text, the `::selection` highlight, and the
AnnotationPopup keep painting** - i.e. a *compositor* paint/raster failure, not a DOM/CSS state bug.
Plus a second effect: an opaque black band (~253x222 CSS px, clean vertical right edge) that hides
even the text under it. Both effects come and go per frame; the reporter says it sometimes survives
the drag ending.

The light video has a normal mean luma around 206.6. During the drag it falls as low as 28.7, with
four distinct dark runs (`1.183..1.725s`, `1.768..2.058s`, `2.800..3.016s`, and
`4.677..4.786s`). That intermittent per-frame timing is consistent with magnifier readback / GPU
composition, not a persistent theme or DOM state change.

**The pill with magnified text in the video is Android's OWN text-selection magnifier, not Readest's
`MagnifierLoupe`.** Proof: the drag handles in the video are native Android teardrops (flat corner
on the inner-top side, accent-blue, semi-transparent), identical to what the Xiaomi draws. Readest's
own handles/loupe only appear when `selection.handlesSuppressed` is set, which on `dev` happens
**only when a lookup surface opens** (dictionary/translate/proofread, see
`useTextSelector.suppressNativeSelectionHandles`) or for fixed-layout-scrolled (`#5809`). A plain
selection on a reflowable EPUB uses native handles. So `foliate-js` `showLoupe`/`setHole` (the
`clip-path` with the `-2000000..4000000` outer rect) is **not** in the reporter's code path.
Black frames correlate with the system magnifier being on screen.

The implementation chain is now confirmed from Chromium M153 source:

1. `SelectionPopupControllerImpl.onDragUpdate()` creates a `MagnifierAnimator`.
2. Regular Android WebView uses `MagnifierWrapperImpl`, which constructs
   `new android.widget.Magnifier(view)` and calls `show(x, y)` on every drag update.
3. AOSP `android.widget.Magnifier` copies the source region with `PixelCopy` and presents it in a
   separate `SurfaceControl` surface.
4. Chromium has an alternative `MagnifierSurfaceControl` implementation, but WebView does not opt
   into it; `setAllowSurfaceControlMagnifier()` is called by Chrome, not Android WebView.

This explains both the Samsung-styled pill and why its sampled content is itself corrupted. The
best current root-cause hypothesis is a **Samsung Android 16 / Mali-G68 WebView compositor-readback
failure triggered by the platform `Magnifier`'s PixelCopy loop**. Confidence is high for the
subsystem, but the precise driver/Chromium change is not yet proven without the failing phone.

## What was tried on the Xiaomi (368b0948, Android 16) - all clean, no artifact

Built + installed current `dev` (release aarch64, `pnpm dev-android`), drove it over CDP
(`adb forward` + `Runtime.evaluate`), real native-handle drags via `adb shell input motionevent
DOWN/MOVE/UP`, `screenrecord` + ffmpeg contact sheets for every run:

- WebView **152.0.7977.64**, **153.0.7978.2** (dev), **154.0.8037.0** (beta) - switched with
  `adb shell cmd webviewupdate set-webview-implementation <pkg>`
- Light **and** dark theme (`adb shell cmd uimode night no|yes`)
- Small section (Pride & Prejudice ch.1, `scrollWidth` 3142) **and** a 2417-page single section
  (`EOB_NT`, `scrollWidth` **422182**) - the user's "large section" hypothesis
- `showLoupe` animated at 60Hz with and without a live DOM selection
- Memory pressure: `adb shell am send-trim-memory ... RUNNING_CRITICAL` mid-drag
- A `mix-blend-mode: multiply` background-texture layer injected over the viewer
- `LayerTree.enable` snapshots: the loupe's `clip-path` does **not** change layer count or bounds
- WebView **154.0.8037.0** with `WebViewSingleSharedContextState` explicitly forced **Enabled** in
  WebView DevTools, followed by controlled native-handle drags and display `screenrecord`: clean

The last probe matters because the reporter's `153.0.8010.11` includes a new, Finchable Chromium
feature, `WebViewSingleSharedContextState`, that did not exist in the tested `153.0.7978.2` build.
It shares GPU `SharedContextState` objects across WebViews and gained Vulkan support immediately
before the 8010 branch point. Forcing it on under M154 on the Xiaomi still did not reproduce the
artifact. It remains a useful A/B toggle on the actual Galaxy A26, but is no longer a strong
standalone root-cause candidate.

**Correction to the earlier blocked-lever note:** a debug Readest APK does **not** unlock arbitrary
WebView command-line switches on this production Xiaomi. Chromium's `CommandLineUtil` reads
`/data/local/tmp/webview-command-line` only when the **Android OS build** is userdebug/eng
(`AndroidInfo.isDebugAndroid()`), independent of whether the embedding APK is debuggable. On a
production `user` device, use the WebView DevTools activity and only its production-supported
flags. For example:

```bash
adb shell am start -n \
  com.google.android.webview.dev/org.chromium.android_webview.devui.MainActivity
adb shell content query --uri \
  content://com.google.android.webview.dev.DeveloperModeContentProvider/flag-overrides
```

Useful supported probes include `disable-gpu-rasterization`, `show-composited-layer-borders`, and
(on builds new enough to contain it) `WebViewSingleSharedContextState`. Emulators
(`Android_17` = android-37.1 playstore_ps16k arm64) **hang on boot** on this host ("detected a
hanging thread 'QEMU2 CPU0'") with `-gpu host` and `-gpu swiftshader_indirect`; only
android-28/34/35/37.1 images are installed, no android-36.

## Codebase finding worth fixing anyway

`src/styles/globals.css` has `html[data-page='default'|'library'|'reader'] { background: ... }`,
but **nothing in the app ever sets `data-page` on `<html>`** (grep: only those three CSS rules).
Confirmed on device: `getComputedStyle(documentElement).backgroundColor === 'rgba(0,0,0,0)'` and
the same for `body`; the visible background comes only from inner `.reader-page/.bg-base-100` divs.
So the document has no root background colour and the compositor's fill for anything it can't
raster is the platform base colour, not the theme colour. (On the Xiaomi that fallback reads
**white**; Tauri asks for `background_color(Color(50,49,48,255))` in `src-tauri/src/lib.rs:653`.)
Restoring an opaque theme background on `html` is a cheap defensive fix that would make this class
of full-background dropout less visible. It cannot repair the corrupted magnifier sample or the
opaque band that covers glyphs, so it is mitigation rather than the root fix. The transparent-root
state is also present unchanged in tags v0.11.20, v0.12.1, and v0.12.6, so it is not the regression
boundary by itself.

## Highest-value next test (must run on the Galaxy A26)

Use the WebView DevTools Flags screen on the reporter's `SM-A266B`, restarting Readest between
changes:

1. Set `WebViewSingleSharedContextState` to **Disabled** on WebView 153.0.8010.11.
2. Separately reset it to Default, then set `disable-gpu-rasterization` to **Enabled**.
3. Record the same multi-line handle drag after each change.
4. Also finish the already-requested Readest 0.12.1 / 0.11.20 comparison.

Interpretation: only (1) fixes it -> M153 shared-context/Finch path; only (2) fixes it -> GPU raster
or Mali driver path; neither fixes it but older Readest does -> app regression; none fix it ->
Samsung framework `Magnifier` / PixelCopy path is the primary suspect and needs a minimal native
WebView repro plus logcat for upstream filing.

## Device state after the session

WebView provider restored to `com.google.android.webview.dev` **153.0.7978.2**; beta DevTools flag
overrides reset (`No result found`); night mode back to `yes`; `/data/local/tmp/webview-command-line`
and pushed files removed. **Permanently changed:** WebView
stable 148->152.0.7977.64, beta 152->154.0.8037.0, canary 153->155.0.8039.0 (updated via Play to
chase 153.0.8010.x - never got it, Play jumps straight past that build); the phone now runs a
`dev`-branch Readest build instead of 0.12.6; `EOB_NT` is imported into the library.

Related: [[feedback-always-verify-on-xiaomi]], [[annotator-overlay-z-layers]],
[[lookup-surface-flash-suppress-handles-6013]]
