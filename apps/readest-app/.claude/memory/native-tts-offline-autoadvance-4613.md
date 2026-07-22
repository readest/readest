---
name: native-tts-offline-autoadvance-4613
description: "Android/iOS System TTS stops at chapter end (or random intervals) offline — controller only auto-advances on 'end', native terminal 'error' dead-ends + wedges state"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ae3d6fc-9082-4ba2-b7d4-e02dd277ee8f
---

# Native System TTS offline auto-advance halt (#4613, #4408)

**Symptom:** With Android System TTS (or iOS) **offline**, read-aloud stops — #4613 "at the end of the chapter, won't go to next chapter" (Samsung S25, Chinese voices); #4408 "random intervals" (GrapheneOS, Supertonic engine). Then the play/headphone controls feel **wedged**; #4408 also flashes the "Please log in to use advanced TTS features" toast on manual restart (separate client-selection path — controller briefly tries Edge).

**Root cause (`TTSController.#speak`):** auto-advance fires ONLY on `lastCode === 'end'`. The native client surfaces an offline engine failure as a terminal **`'error'`** code (Android `UtteranceProgressListener.onError`). Usually a **specific unsynthesizable utterance** (an unsupported CHARACTER — chrox's insight, fits online/offline asymmetry: engines network-fall-back for hard chars when online), hit on the new chapter's first utterance. On `'error'`: no `forward()` → playback dead-ends; `this.state` stays `'playing'` → controls wedge (restart re-errors on the same chunk). Edge/Web throw instead (caught by `error()` → state 'stopped'), so only **native** hits this. Engine-specific: Google local voices emit `onDone` fine, so it doesn't reproduce on every device.

**Fix (PR #4716, `#speak` only):** gate `canSkipOnError = this.ttsClient === this.ttsNativeClient`. On terminal `'error'` (native, playing, !aborted, !oneTime): **SKIP the chunk and `forward()`** — same as `'end'` — because re-speaking deterministically-bad text just fails again (do NOT retry; first attempt was retry-the-same-chunk which is futile for an unspeakable char). Bound `#consecutiveSpeakErrors` (reset on `'end'`); when it exceeds `TTS_NATIVE_SPEAK_MAX_CONSECUTIVE_ERRORS=5` → `await this.stop()` (graceful: wholly-unusable engine stops instead of silently racing to book end; leaves 'playing' so controls recover). Edge/Web byte-for-byte unchanged. Tests (`tts-controller.test.ts` "native TTS offline error recovery (#4613, #4408)"): skip-advances-past-bad-chunk (forward spied) + cap-stops-gracefully (key off `state.attempts` NOT `state` — controller starts 'stopped' and `forward()` transiently re-enters 'stopped', so `waitFor(state==='stopped')` false-matches).

**On-device verification reality (Xiaomi 13 fuxi, Android 16, WebView 147, Google TTS):** CANNOT reproduce the fault — offline auto-advance works, even offline+screen-off (foreground-audio service keeps the WebView UNthrottled; Google local engine emits onDone offline). Matches maintainer's non-repro. Needs the reporter's engine (Samsung/Supertonic/Chinese-network voice). Force the engine-error path on this device by setting a `*-network` voice offline. See [[cdp-android-webview-profiling]] for the CDP recipe; gotcha: `window.__TAURI_INTERNALS__.invoke`/`runCallback` get RE-INJECTED on Next.js client nav (wrappers revert) — `console.log` wrapping persists, so trace via the `[TTS] speak` / `[TTS] Initialized TTS for section N` logs instead. Related: [[tts-fixes]], [[tts-browser-e2e-harness]].
