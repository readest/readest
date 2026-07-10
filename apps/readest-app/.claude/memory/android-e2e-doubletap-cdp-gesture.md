---
name: android-e2e-doubletap-cdp-gesture
description: Nightly Android E2E double-tap test failed since
metadata: 
  node_type: memory
  type: project
  originSessionId: eafe11ed-faac-4406-957d-1674353f081c
---

Nightly `Android E2E (CDP)` failed every night from 2026-06-28 (first night after
PR #4846 merged) with `timed out waiting for selection of "..." (last: null)` in
`double-click.android.test.ts`. The test never passed on CI. Fixed 2026-07-04 —
harness-only, no app code changed.

**Two stacked root causes:**

1. **PRIMARY — feature is opt-in on mobile.** `DEFAULT_MOBILE_VIEW_SETTINGS`
   ships `disableDoubleClick: true` (double-click detection delays single-tap
   page turns by the 250ms disambiguation window, so mobile opts out).
   `handleClick` (iframeEventHandlers.ts) then posts `iframe-single-click`
   IMMEDIATELY and never arms the double-click window — the #4846 double-tap
   word selection is deliberately "gated by the user's double-click setting"
   (Annotator comment). The e2e assumed default config → could never pass on a
   fresh device. Diagnostic signature: `iframe-single-click` ~20ms after click
   (window disabled) vs ~250ms after (window armed, no second click).
2. **SECONDARY — adb double-tap can't hit the window.** The old helper ran
   `input tap x y && input tap x y`; each `input` invocation spawns a fresh
   app_process JVM (measured 0.9–1.05s each, 28s cold). Warm fast host ≈130ms
   click gap (passes), loaded CI emulator >250ms (always fails).

**Fix (all in `src/__tests__/android/`):**
- `reader.ts patchGlobalViewSettings(patch)` — force-stop app, read/patch
  `settings.json` `globalViewSettings` via `adb shell run-as` (debug builds
  only; file lives at the app data dir ROOT, not files/), write back via
  base64 pipe, return previous values for restore in afterAll. Missing
  settings.json is fine: `loadSettings` deep-merges partial file over defaults.
- `cdp.ts CdpPage.doubleTap(cssX, cssY)` — ONE
  `Input.synthesizeTapGesture {tapCount: 2, duration: 20, gestureSourceType: 'touch'}`;
  renderer-internal timing gives ~200ms click gap on a busy emulator. TWO
  sequential synthesizeTapGesture commands are too slow (~535ms gap — each
  resolves long after its gesture). Raw `Input.dispatchTouchEvent` delivers
  touch events but does NOT reliably synthesize clicks on Android WebView.
- Word finder requires `range.getClientRects().length === 1`: a
  hyphenated/wrapped word's bounding rect spans two lines, so its center taps
  between lines and selects the neighboring word (saw `'party' !== 'sensation'`).
- `dismissSelection` picks a mid-column tap spot (0.78H or 0.25H) that the
  `.selection-popup` doesn't cover — a blind 0.78H tap can press a toolbar
  button when the selection sits low.

**Other gotchas:** headless emulator display sleeps → adb `input` no-ops while
CDP input still works (`input keyevent KEYCODE_WAKEUP`); a leaked single-click
(broken double-tap) toggles header or opens the media viewer, contaminating the
session; local repro = `pnpm tauri android build --debug --target aarch64` +
`adb install -r` + `pnpm test:android`.

Related: [[android-cdp-e2e-lane]], [[iframe-double-click-word-select]]
