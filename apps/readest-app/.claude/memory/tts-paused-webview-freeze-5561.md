---
name: tts-paused-webview-freeze-5561
description: "#5561 Bluetooth Play cannot resume TTS after a pause - a PAUSED session drops the audio keep-alive, Chromium freezes the hidden page, and the media-session handlers (which live in the page) never run; fix = keep the tone while paused, on its OWN AudioContext"
metadata:
  node_type: memory
  type: project
---

# Paused TTS + backgrounded app = frozen WebView, dead lock-screen/Bluetooth transport (#5561)

**PR readest/readest#5567 MERGED** 2026-08-07 (squash `629ab2919`; branch + worktree cleaned up, shared cargo target was never touched by that worktree so no `cargo clean -p` was needed). Confirmed fixed on the real Bluetooth headset by the user before merge.

**Symptom (reporter kv-u, Samsung Android 13/One UI 5.3):** pause from a Bluetooth headset, wait 3-10 s, press Play -> nothing. Reproduced across 5 Android TextToSpeech engines; reporter said Edge TTS was fine. Opening Readest and pressing Play in-app resumes from the same position.

**Root cause:** `TTSController.pause()` called `stopAudioKeepAlive()`. The inaudible 40 Hz tone from [[native-tts-screenlock-keepalive-4408]] is the only thing making the WebView page "audible", and audibility is what exempts a hidden page from Chromium's throttle-then-FREEZE of its task queues. Once paused + backgrounded the page emits nothing, freezes, and **the media-session play/pause/next handlers live in that page** (`ttsMediaBridge` -> `TTSController`). `MediaPlaybackService` runs in the app's MAIN process, which the foreground service keeps alive, so the native half keeps answering: the notification/lock-screen card flips to PLAYING and the silent ExoPlayer keep-alive resumes — but no speech, and the in-app mini player stays out of sync. Foregrounding thaws the page.

**Not engine-specific.** Measured on Xiaomi 13 / Android 16: Edge freezes too (68 s). The reporter's "Edge is fine" is most likely a shorter test, not immunity. Fix therefore covers every engine while paused.

**Fix (`#syncAudioKeepAlive`, renamed from `#syncNativeAudioKeepAlive`):** `isAndroidApp && (mediaClock === false || state.includes('paused'))`. Call it from `pause()` and `#stopAtChapterBoundary()` (set the state FIRST — the predicate reads `this.state`) instead of `stopAudioKeepAlive()`. `#terminate()`/`shutdown()` still stop it outright: that is the session actually ending.

**The tone needs its OWN AudioContext.** Buffered engines pause by suspending the *shared* context (`WebAudioPlayer.pauseContext`), which would silence the tone exactly when a paused session needs it — and resuming that context to feed the tone would un-pause the speech. `stopAudioKeepAlive` now `close()`s the dedicated context (an idle-but-running context still renders silence into an open output stream).

## Instrumentation that actually worked (Xiaomi 13, Android 16, release APK)

- **`adb shell input keyevent 126/127/85` is NOT equivalent to a Bluetooth AVRCP button on MIUI.** Logcat shows `D/SmartPower: com.bilingify.readest/...: press media key` — MIUI un-throttles the app on a media key press, so software keys ALWAYS resumed and hid the bug through hours of testing. `adb shell cmd media_session dispatch play` bypasses that hook and reproduces it. Real headset button also reproduces.
- **WebView devtools is open on the release build:** `adb shell cat /proc/net/unix | grep devtools` -> `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`. See [[android-cdp-e2e-lane]].
- **Freeze probe:** install `setInterval(500)` pushing `Date.now()` into an array, detach, background + pause, wait, re-attach and read. `lastTickAgoMs` is the tell (`Runtime.evaluate` still works on a frozen page — the array's staleness is the evidence, not the ability to evaluate).
- `window.__TAURI_INTERNALS__.invoke` is **non-writable and non-configurable** — it cannot be monkey-patched to trace plugin IPC. Assignment fails silently in sloppy mode (looks installed, isn't). Verify with `Object.getOwnPropertyDescriptor`.
- Renderer priority: `adb shell dumpsys activity processes | grep "Proc #.* <renderer-pid>:"`. Drops `fg` -> `prcp` about 5-10 s after pause (the reporter's "3-10 seconds"), page timers die ~60 s later.
- AVRCP's exact view of the session: `adb shell dumpsys bluetooth_manager` -> `List of MediaControllers` -> `<Active> Media Player 1: com.bilingify.readest` with `Song{... duration=...}` + `PlayState`.

**End-to-end verified on the built APK** (`pnpm dev-android`, Xiaomi 13 / Android 16, System TTS `en-US-language`): backgrounded, paused, waited 150 s (control froze at ~68 s), `cmd media_session dispatch play` -> 4 `Synthesis request` lines, speech resumed, in-app mini player back in sync.

**Measurements (backgrounded + paused):** no tone / System TTS -> timers dead after 68 s. No tone / Edge -> dead after 68 s. **Web Lock held -> dead after 71 s (NOT a freeze blocker on Android WebView).** Tone created while visible -> 117 s no gaps. Tone created while hidden -> 167 s no gaps, still ticking. A fresh `new AudioContext()` created while `document.visibilityState === 'hidden'` comes up `running` (sticky activation from the gesture that started TTS), which is what makes the pause-time creation safe.

## Adjacent defects found, NOT fixed here

1. `MediaPlaybackService.currentPositionMs`/`currentDurationMs` are companion fields that are never reset per session. With a `mediaClock: false` engine the JS never pushes position/duration, so the session keeps publishing whatever the previous Edge session left — observed `position=316348, duration=568683` frozen under System TTS playback (0/0 on a cold start).
2. `stateBuilder.setState(state, currentPositionMs, 1f)` publishes **playbackSpeed 1.0 while PAUSED** (`MediaPlaybackService.kt` `updatePlaybackState` + `applyPlaybackState`). `PlaybackState.getCurrentPosition()` = `position + speed * elapsed`, so the reported position runs away while paused — and past a duration of 0 within a second for direct-speak engines.

Related: [[native-tts-screenlock-keepalive-4408]], [[android-bg-tts-media-session-fix]], [[tts-fixes]].
