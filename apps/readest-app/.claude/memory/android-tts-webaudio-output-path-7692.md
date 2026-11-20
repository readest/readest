---
name: android-tts-webaudio-output-path-7692
description: "#7692 read-aloud quieter than voice preview on HONOR; Xiaomi routes Web Audio to a fast track, not MMAP, and is not quieter; acoustic loudness recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: d359d43d-4523-4d41-bce6-2072624170bb
  modified: 2026-11-20T09:55:52.881Z
---

#7692 (2026-11-20, HONOR Magic8 Pro): the default `AudioContext` (shared TTS context, `src/services/tts/WebAudioPlayer.ts`) lands on `mmap_no_irq_out`, which skips the OEM effect stage, so read-aloud is quieter than the `<audio>` voice preview (`voicePreview.ts`). The reporter's fix: `latencyHint: 'playback'` on Android.

Xiaomi 13 (368b0948, WebView 153) result:
- Default context: fast track on primary output `AudioOut_D`, baseLatency 0.003. `<audio>`: `deep_buffer` `AudioOut_25`, which also carries the session-0 chain (MiSound disabled, DAP_offload enabled).
- With `'playback'`: baseLatency 0.021, outputLatency 0.024, and the track moves onto the same deep-buffer thread as `<audio>`.
- Speaker level for the same noise (MacBook mic): `<audio>` -39 dB, default Web Audio -37 dB, `'playback'` -39 dB. So the default path is about 2 dB louder here, and the gap is specific to devices that pick MMAP.

Recipe: CDP `Runtime.evaluate` a script that plays the same PCM through `new Audio(wavBlob)` and through `AudioContext` buffer sources in sequence. Record with `ffmpeg -f avfoundation -i ":2"` (MacBook mic), with the phone placed by the Mac, then take the RMS of each 0.5 s window. `dumpsys media.audio_flinger` shows the thread and effect chain for each track.

Gotcha: on MIUI, `cmd media_session volume --set/--adj` reports success but leaves the music index unchanged. Change the volume by hand.
