---
name: android-auto-tts-3919
description: "Android Auto TTS (#3919) — Play keeps rejecting the Auto feature for inconsistent car audio; opt-in withdrawn #5038, re-enabled #5066, withdrawn AGAIN for 11020 in PR#5235. Toggle via one manifest meta-data + guard test."
metadata:
  node_type: memory
  type: project
  originSessionId: 87b553ae-fcfd-4e40-8f37-d8e926f18961
  modified: 2026-07-21T10:00:25.856Z
---

Android Auto TTS media support (#3919, PR#4907) lets Readest appear in the car launcher and project the TTS media session via the exported `MediaBrowserService` `com.readest.native_tts.MediaPlaybackService`. CarPlay counterpart blocked on Apple entitlement ([[carplay-tts-support]]).

**The single toggle:** the `<meta-data android:name="com.google.android.gms.car.application" android:resource="@xml/automotive_app_desc" />` inside `<application>` in `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. That meta-data ALONE is what makes Play run its Android Auto review. Removing it withdraws the Auto feature; re-adding it re-enables. The `res/xml/automotive_app_desc.xml` descriptor and the exported MediaBrowserService intent-filter (`android.media.browse.MediaBrowserService`) stay in place regardless — the service also backs the phone lock-screen/background TTS media session ([[android-bg-tts-media-session-fix]]) and does NOT by itself trigger Auto review.

**Note:** the manifest lives under gitignored `src-tauri/gen`, but the file is force-tracked (from #5066). Edit it directly; `git add -f` is needed to stage it.

**Guard test:** `src/__tests__/android/android-auto-declarations.test.ts`. When withdrawn it asserts `expect(manifest).not.toContain('com.google.android.gms.car.application')`; when enabled it asserts `toContain`. Flip that one assertion when toggling. The descriptor + MediaBrowserService assertions stay unchanged. IMPORTANT: any manifest comment must NOT contain the literal `com.google.android.gms.car.application` string or the `not.toContain` test fails.

**Rejection history (Play keeps flagging the SAME bug — inconsistent TTS audio in the car):**
- Enabled by #4907. Rejected 2026-07-09 -> withdrawn in PR#5038 (broken forward/back feedback: silent player seeked to 0, metadata lagged ~1s WebView round trip).
- Skip path fixed (ttsMediaBridge `#skipping` holds optimistic playing state; MediaPlaybackService no longer seeks the silent keep-alive player on skip) -> re-enabled in #5066 (commit ee727b0cb).
- Play REJECTED version code 11020 (0.11.20) on 2026-07-20 again for "Audio inconsistently plays on the Android Auto environment" -> withdrawn AGAIN in PR#5235 (2026-07-21) to unblock the release. The underlying car audio bug is deferred, NOT fixed.

**Repro rig that works (2026-07-21):** DHU (`$ANDROID_HOME/extras/google/auto/desktop-head-unit`, arm64) + full Android Auto (gearhead) sideloaded on a Pixel phone emulator (the preinstalled `AndroidAutoStubPrebuilt` is a stub — download real gearhead APK from APKMirror). Key gotchas: run DHU with a FIFO on stdin (`sleep 100000 > fifo &; dhu < fifo`) or it EOF-exits; first DHU connect after a server (re)start often drops on transport, second succeeds; the FRX "notification access from your phone" gate is the wall — grant it (`cmd notification allow_listener '<comp>$ListenerService'`, escape the `$` so the DEVICE shell doesn't expand it) BEFORE connecting, and if the emulator SystemUI ANRs, `adb reboot` for a clean slate (notif access + AA dev mode persist). Capture the DHU window by CGWindowID via `screencapture -l<id>` (computer-use can't allowlist it; a Swift CGWindowListCopyWindowInfo helper finds the id). Observed bug signature: car UI PlaybackState/scrubber position out of sync with the actual `MediaSession` `PlaybackState` (dumpsys media_session showed PAUSED at a different position/sentence than the car displayed).
