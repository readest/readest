---
name: carplay-hidden-app-music-stops-7168
description: "#7168 iOS 27 CarPlay: opening Readest on the phone stops car music and CarPlay shows Readest's list even though hidden; NOT reproduced, needs-info asked 2026-10-31"
metadata:
  node_type: memory
  type: project
  originSessionId: 7460d824-4711-4f63-8f06-498530415afa
  modified: 2026-10-31T19:18:12.398Z
---

#7168 (iOS 27.0.1, 0.12.16, reported 2026-10-30): Readest hidden via Settings > CarPlay > Customize; music playing in the car; opening Readest on the phone stops the music, CarPlay shows Readest's root list template, and "can't read anything" on the phone.

Code facts checked 2026-10-31:
- The only non-mixable audio claim is `claimAudioSession()` in `tauri-plugin-native-tts` (`.playback/.spokenAudio`, no options), reached only via `set_media_session_active` from `ttsMediaBridge.bind` (Read Aloud start). Nothing on launch calls it.
- VolumeKeyHandler (native-bridge) uses `.mixWithOthers`, can't stop music. `use_background_audio` is obsolete (no JS callers).
- Car autoplay deep links (`readest://book/<hash>?autoplay=tts`) are deduped per process by `markLaunchUrl`.
- Hypothesis: hiding only removes the icon; iOS still shows the Now Playing app's CarPlay UI, so the real bug is whatever claims audio at open (paused Read Aloud session left alive in the background?). Unproven.

Couldn't reproduce: no CarPlay Simulator (Additional Tools) installed; the iOS sim delivers no cross-app audio interruptions ([[carplay-interruption-resume-6444]]). Needs-info reply sent asking: background paused TTS?, does it start reading by itself?, phone screenshot, without CarPlay?, Use Volume Keys + voice.
