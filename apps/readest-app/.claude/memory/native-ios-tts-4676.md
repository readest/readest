---
name: native-ios-tts-4676
description: Native local iOS TTS (AVSpeechSynthesizer) mirroring the Android native TTS plugin;
metadata: 
  node_type: memory
  type: project
  originSessionId: ec6b5ad5-f187-4615-83b4-33b1a9e77ba7
---

# Native local iOS TTS (#4676)

STATUS: MERGED (PR #4697, into main 2026-06-21). Device-verified by maintainer:
system-voice playback, voice selection, rate/pitch, auto-advance, pause/resume,
stop/disable teardown, and lock-screen controls + metadata for both system and
Edge TTS. Final design = iOS lock screen via `navigator.mediaSession` (NOT the
native plugin); the Swift media-session methods are dead on iOS (Android-only).
Diagnostic logging was stripped before merge.

Goal: give iOS the same on-device TTS Android has (private, offline). The shared
TypeScript `NativeTTSClient` (`src/services/tts/NativeTTSClient.ts`) and the Rust
command/mobile layer (`src-tauri/plugins/tauri-plugin-native-tts/src/{commands,mobile,models}.rs`)
were already platform-agnostic — only the Swift plugin (a `ping()` stub) and two
gates were missing. See [[tts-fixes]].

## What was changed
- **`ios/Sources/NativeTTSPlugin.swift`** — full impl mirroring `android/.../NativeTTSPlugin.kt`.
  Commands: init, speak, stop, pause, resume, set_rate, set_pitch, set_voice,
  get_all_voices, set_media_session_active, update_media_session_state,
  update_media_session_metadata, checkPermissions/requestPermissions.
- **`TTSController.ts:91`** gate: `isAndroidApp` → `isAndroidApp || isIOSApp` (creates `ttsNativeClient`).
- **`mediaSession.ts` `getMediaSession()`** reorder: check native platforms FIRST
  (`(android||ios) && isTauriAppPlatform()` → `TauriMediaSession`), THEN
  `'mediaSession' in navigator`. iOS WKWebView (and Android WebView) expose
  `navigator.mediaSession`, but the web session can't drive lock-screen controls
  for AVSpeech/TextToSpeech — so it must lose to the native plugin.
- Tests: `tts-controller.test.ts` iOS gate + new `__tests__/libs/mediaSession.test.ts`.

## Non-obvious gotchas
- **`init` is a Swift reserved word.** Tauri iOS dispatch = `perform(Selector("\(command):"))`
  (`mobile/ios-api/.../Tauri.swift`), so the "init" command needs selector `init:`.
  Solution: `@objc(init:) public func initialize(_ invoke: Invoke)`. Verified it
  compiles + `responds(to: Selector("init:"))==true` via swiftc. `perform` doesn't
  apply ARC init-family retain rules (those are compile-time, direct-send only).
  If it ever misbehaves on-device, fallback = rename the command for iOS in `mobile.rs`.
- **Pause == stop (mirror Android).** JS `NativeTTSClient.pause()` returns `false`,
  so `TTSController.pause()` (line 472) does stop + re-speak on resume. The Swift
  delegate must emit `end` ONLY on `didFinish`, **never on `didCancel`** (cancel
  comes from stop/pause; an `end` there would auto-advance the reader).
- **AVAudioSession is owned by native-bridge.** `useTTSControl` calls
  `invokeUseBackgroundAudio({enabled})` (plugin:native-bridge|use_background_audio →
  `.playback`) on iOS TTS start/stop. AVSpeechSynthesizer uses the app session
  (`usesApplicationAudioSession` defaults true), so the native-tts plugin does NOT
  touch the audio session. Background + silent-switch playback comes for free
  (Info.plist already declares `UIBackgroundModes: [audio]`).
- **MPRemoteCommandCenter.shared() is app-global and shared** with native-bridge's
  `MediaKeyHandler` (hardware media-key page-turns on next/previousTrack). The
  native-tts plugin stores its `addTarget` tokens and removes ONLY those on
  deactivate. Lock-screen next/previous + the media-key page-turn both fire if
  both are active — on-device test point.
- **Rate curve.** JS sends `pow(userRate, 2.5)` (tuned for Android setSpeechRate,
  1.0=normal). Swift `avRate()` inverts (`^(1/2.5)`) and rescales onto
  AVSpeechUtterance (0…1, `AVSpeechUtteranceDefaultSpeechRate`≈0.5 = normal). Top
  speeds saturate at max (AV limitation).
- Voice id = `AVSpeechSynthesisVoice.identifier` (round-trips through set_voice →
  `AVSpeechSynthesisVoice(identifier:)`). All iOS voices group under "System TTS"
  in the JS `getVoices` (no `_`-prefixed engine id); enhanced/premium quality
  appended to the display name to disambiguate same-named variants.
- Permissions already granted: `native-tts:default` (no platform restriction in
  `capabilities/default.json`) covers every command.

## Media session on iOS — REVERTED the native reroute (round 3)
- On-device trace confirmed parallel teardown WORKS (`stop: wasSpeaking=true stopSpeaking returned true` → `set_media_session_active active=false` → `deactivateRemoteCommands: removed 5 targets, cleared nowPlayingInfo`). The remaining media-session problems were caused by the `getMediaSession()` reroute itself:
  - Edge TTS lock screen lost cover + current sentence (REGRESSION): Edge plays via a WebView `<audio>` element → its lock-screen card is driven by `navigator.mediaSession.metadata` (set in `useTTSControl`). Routing iOS to `TauriMediaSession`/`MPNowPlayingInfoCenter` bypassed that.
  - System TTS got NO controls: `AVSpeechSynthesizer` is not a WebView media element, so the app never becomes "Now Playing" and the plugin's `MPRemoteCommandCenter` targets never surface. (Edge gets controls because its `<audio>` element makes the app now-playing.)
- FIX: `getMediaSession()` reverted so iOS uses `navigator.mediaSession` (Android still first→`TauriMediaSession` foreground service). iOS system TTS now rides the same WebView path as Edge — the silent keep-alive `unblockAudio` `<audio>` element + `navigator.mediaSession` metadata/action-handlers. OPEN/UNVERIFIED: whether the SILENT keep-alive element registers as Now Playing on iOS (if not, system TTS still shows no card — would need a non-silent keep-alive or a real native now-playing implementation). The iOS Swift media-session methods (set_media_session_active etc.) are now DEAD on iOS (only Android Kotlin uses them via TauriMediaSession); left in place, harmless.
- Heavy Swift diagnostic logging (per-voice dump + per-command enter/resolve + delegate) still present; trim once confirmed.

## Follow-up iOS fixes (same PR)
- **Duplicate voice names**: Eloquence + legacy "novelty" voices (Rocko, Shelley, Grandma, Grandpa, Eddy, Reed, Flo, Sandy…) ship in many regions of one language, all quality=default. JS `getVoices` groups by primary language (`isSameLang`→normalized subtag), so e.g. en-US "Rocko" + en-GB "Rocko" collide in one "System TTS" list. Fix (in Swift `get_all_voices`): count `(primaryLanguage, displayName)`; for collisions append `regionDescription` (localized region, e.g. "Rocko (United Kingdom)"). Unique names stay clean. 192 system voices on a loaded device.
- **First word clipped "sometimes"**: each sentence is a separate `AVSpeechUtterance` spoken after a gap → audio route goes cold between sentences → first phonemes clipped. Same family as the startup `!act` (cannotActivate) `AVAudioSession` error from native-bridge `use_background_audio`. Fix: `utterance.preUtteranceDelay = 0.1` warms the route with silence first.
- **Stop "never tears down" / TTS icon stays blue (native only, Edge fine)**: the icon's blue state is driven by `viewState.ttsEnabled` (footer toggle) AND `isPlaying`/`showIndicator` (floating gradient `TTSIcon`). `handleStop` (useTTSControl) did all of `setIsPlaying`/`showIndicator` THEN `await ttsController.shutdown()` THEN `setTTSEnabled(bookKey,false)` as the LAST line — with NO try/catch. So if native `shutdown()` hangs OR throws, `setTTSEnabled(false)` never runs → footer icon stays blue forever; Edge never hits the stalling native path. ROOT FIX = reset ALL UI/session state (incl. `setTTSEnabled(false)`, null the ref) UP FRONT, then run shutdown/deinit best-effort in try/catch. Couldn't statically prove the exact native hang (every await in shutdown→stop is bounded/resolvable; native stop resolves since set_voice/set_rate use the same `resolve()` and playback works), so ALSO: bounded native stop invoke in `NativeTTSClient.stop()` (1500ms `Promise.race`) + Swift `os.Logger` lifecycle traces (speak/stop/pause/didStart/didFinish/didCancel) to pinpoint on-device — tapping stop should log `stop: requested`→`stop: resolved` + `didCancel`. Guard tests in `useTTSControl.test.tsx` assert `setTTSEnabled(false)` runs even when `shutdown()` rejects/never-resolves. NOTE: web bundle must be rebuilt for these JS fixes (not just the Swift plugin).
- **Lock-screen media session keeps running after disable (native only) — round 2**: the icon fix moved `setTTSEnabled` early, but `deinitMediaSession()` + `invokeUseBackgroundAudio({enabled:false})` were STILL after `await ttsController.shutdown()`. Native `shutdown()` stalls → those never run → lock-screen Now Playing lingers (Edge unaffected: never hits the stalling native path). The Swift media-session teardown is correct (Edge proves `set_media_session_active(false)`→`deactivateRemoteCommands` clears `MPNowPlayingInfoCenter.nowPlayingInfo`) — it just wasn't being CALLED. FIX = run shutdown + `invokeUseBackgroundAudio(false)` + `deinitMediaSession()` via `Promise.all` (best-effort, parallel) so media/audio teardown never waits on the controller shutdown. Added `set_media_session_active` os_log + guard test (deinit called even when shutdown never resolves). Still UNCONFIRMED why native `shutdown()` itself stalls (all JS awaits bounded; native stop invoke should resolve) — Swift lifecycle logs will reveal on-device.

## Verification done / pending
- Done (host): `pnpm lint`, `pnpm test` (only pre-existing unrelated
  `fixed-layout-paginated-scroll.test.ts` fails — untracked, no impl), swiftc
  `-typecheck` of the plugin vs iOS SDK with Tauri stubs (0 errors; Sendable
  warning is a standalone-swiftc strict-concurrency artifact, project is Swift 5).
- Pending (on-device, user): build iOS, confirm init/speak/voices/rate/pitch,
  auto-advance, pause-resume, lock-screen play/pause/next/prev + now-playing,
  background playback, and the MediaKeyHandler interaction.
