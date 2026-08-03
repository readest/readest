---
name: android-e2e-nightly-fix-5453
description: "First combined Android E2E nightly failed on 3 independent causes - openFixtureBook stale-reader race, Android's one-time 'Viewing full screen' prompt eating injected touches, touch-halo overlap + scrollbar hit-strip; PR #5453"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9fa5b6e3-aa83-46fd-be87-4823e311c152
  modified: 2026-08-02T21:58:33.475Z
---

Nightly android-e2e run 30764355022 (2026-08-02, first run of the 3 new e2e files together) → PR #5453 (fix/android-e2e-nightly). Root causes, each independently verified on a default-profile 320x640 AVD (what CI creates — `avdmanager` default hardware, mdpi, DPR 1) plus Pixel_9_Pro:

1. **openFixtureBook stale-reader race** (`null (reading 'renderer')` in beforeAll): a previous test file's still-open reader satisfies the readiness probes instantly; the VIEW intent then remounts foliate-view and the caller's first evaluate lands in the gap. Fix: `am force-stop` + 1s sleep before the intent (cold-open per file).
2. **Android's one-time "Viewing full screen" prompt** covers the top ~40% of a fresh device's screen when the app first hides system bars and SILENTLY eats every injected touch in its bounds — no DOM events at all. Looks like unexplainable per-position gesture flakiness ("first press works, later ones die" = prompt appears when immersive kicks in). Fix: `settings put secure immersive_mode_confirmations confirmed` in detectAndroidEnv. Diagnosed only by `adb exec-out screencap` — touch-log instrumentation showed nothing pre-DOM.
3. **Touch halos** (#5437 follow-up): `.touch-target::before { inset: -12px }` reached 4px into the neighbor icon at compact `gap-x-2` (≤350px). Now sized `max(100%, 44px)` centered. Plus the header scroller's overlay scrollbar owns a ~5px hit strip at its bottom edge (hits were 40px not 44); `scrollbar-width: none` does NOT remove the strip, `.no-scrollbar` (`::-webkit-scrollbar{display:none}`) does.
4. **#5429 back on notch devices**: header wrapper's safe-area padding box + HintInfo's inset strip are invisible handler-less layers that swallow presses on text inside the top inset (reachable via small/negative margins #5303). Both now `pointer-events-none`. SectionInfo's notch mask is fine — `min(topInset, band.bottom)` never overlaps content top.

**Why:** these four are archetypes: cross-file app state through Android intents; system overlays invisible to DOM instrumentation; hit-area CSS interacting with clipping/scrollbars; decorative overlays needing pointer-events-none.

**How to apply:** when an Android e2e gesture "does nothing" with zero DOM touch events, screencap FIRST — system overlays (immersive prompt, shade) are invisible to DOM probes. SystemUI also captures injected touches starting inside the hidden status bar frame (immersive reveal strip) — gestures cannot be delivered there on emulators; assert hit-test transparency via elementFromPoint instead. CDP `synthesizeTapGesture` with long duration fires long-press but ALSO a trailing tap that self-dismisses the popup — unreliable. `Input.dispatchTouchEvent` bypasses the gesture recognizer entirely (no long-press ever).

Known quirk: double-click.android.test.ts fails on Pixel_9_Pro AVD regardless of these changes (passes on CI profile + 320px AVD; app flow verified OK via CDP probe). ci_like AVD exists locally (320x640, created via avdmanager no-profile; bump hw.ramSize from 96M or it won't boot). Emulators die if proxy env vars point at a dead proxy (127.0.0.1:8118) — launch with `env -u http_proxy ...`.

Related: [[android-cdp-e2e-lane]], [[android-e2e-local-repro-workflow]], [[header-notch-negative-margin-5303]], [[toolbar-touch-target-5401]]
