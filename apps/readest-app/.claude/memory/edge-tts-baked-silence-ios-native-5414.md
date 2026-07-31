---
name: edge-tts-baked-silence-ios-native-5414
description: "#5414 TTS pauses ignore the 0 setting on iOS: Edge MP3s carry ~1s of baked-in silence and the native AVPlayer path never trims it; plus the measurement + Swift compile-check recipes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 94fb89ac-f5c3-4c43-940e-7fbc85bd7eac
  modified: 2026-07-31T17:04:24.925Z
---

**Measured 2026-08-01** (real `audio-24khz-48kbitrate-mono-mp3`, en-US-AriaNeural,
3 sentences, using the exact `findSpeechBounds` algorithm from
`src/services/tts/pcm.ts`): every Edge utterance carries **~0.18s leading +
~0.8s trailing silence = ~1.0s removed per sentence**. The old comment in
`BufferedTTSClient.ts` claiming "~300ms trailing" understated it by ~2.7x;
corrected in the fix.

**Root cause of #5414** (v0.11.20, iOS): `BufferedTTSClient` branches on
`getOSPlatform() === 'ios' && isTauriAppPlatform()`. The web branch runs
`#prepareChunkBuffer` (trim + WSOLA + gapless AudioContext scheduling); the
**native branch added by #5085 skipped trimming entirely** and handed the raw
MP3 to AVPlayer, then added `gapSec` on top via a Swift timer. Audible gap =
~0.8s tail + gapSec + `replaceCurrentItem` load + ~0.18s head, so Sentence
Pause = 0 changed almost nothing. v0.11.18 iOS still used `WebAudioPlayer`, so
v0.11.20 is the first release with it.

**Why:** the pause setting only ever controlled the small additive gap. The
dominant silence lives inside the audio, which only the trimming path removes.

**How to apply:**
- **macOS is NOT affected by this** and reporters conflate the two. macOS stays
  on `WebAudioPlayer`, which still trims. The only new macOS pause in v0.11.20
  is the 0.3s `DEFAULT_PARAGRAPH_GAP_SEC` from #5057 (engine-agnostic, so it
  hits System TTS too) and it does honor 0.
- **"Older versions were smoother" cannot mean pre-v0.11.18 on the Edge path.**
  Before #4931 Edge played through an `<audio>` element with the raw untrimmed
  MP3, so old builds were *worse*. Pin the reporter to a version.
- **Fix cuts the TAIL ONLY** (user's call, 2026-08-01). Leaving the head in
  keeps AVPlayer item time in the same frame as the word boundaries, so no
  offset has to be plumbed through the media clock - the whole JS side stays
  untouched and `trimStartSec` stays 0 by construction. Implementation is then
  one line: `playerItem.forwardPlaybackEndTime`, no AVMutableComposition, no
  seek, and the plain file item keeps its fast load path. Cost: the next
  utterance's ~0.18s of head silence is still audible, so the iOS gap is
  roughly `0.18 + gapSec` vs the WebAudio path's `gapSec`.
- If head trimming is ever wanted, the offset MUST be added back in
  `NativeAudioPlayer.getPlaybackPosition` (per-chunk map, mirroring
  `WebAudioPlayer`'s `trimStartSec + within * mediaScale`) or every word
  highlight lags by the clipped amount.
- Trim constants are duplicated: `pcm.ts` (`findSpeechBounds`) and
  `speechEndSec()` in `NativeTTSPlugin.swift`. Keep them in sync.

**Verification recipes that worked (no device needed):**
- Fetch real audio: `tsx` script importing `EdgeSpeechTTS` from
  `src/libs/edgeTTS`; needs `SUPABASE_URL`/`SUPABASE_ANON_KEY` set to dummies
  or `src/utils/supabase.ts` throws at import on `atob(undefined)`.
- Compare a Node replica of `findSpeechBounds` against a standalone
  `swift BoundsCheck.swift` harness running the real `speechBounds()` body.
  **kept/removed durations matched exactly**; absolute `start` differed by
  ~22ms because AVFoundation strips MP3 encoder delay and ffmpeg does not.
  That 22ms skew is pre-existing (AVPlayer clock vs Edge boundaries), not new.
- Compile-check the Swift plugin without a full `tauri ios build`: the
  gitignored `.tauri/tauri-api` SPM dep only exists in a worktree that has run
  an iOS build, so `ln -sfn <other-worktree>/.../tauri-plugin-native-tts/.tauri`
  then `xcodebuild -scheme tauri-plugin-native-tts -sdk iphonesimulator
  -destination 'generic/platform=iOS Simulator' build`. Remove the symlink after.

**Separate bug found in the same pass (fixed here):** #5326 removed the pause
sliders and derives gaps via `scaleGap = Math.round(baseGap / rate^0.6)`. Both
base gaps are sub-second (0.15 / 0.3), so `Math.round` returns **0 at every
rate** - on `dev` both gaps are silently zero after any speed change and there
is no UI left to restore them. Fixed to 2-decimal rounding; whether the sliders
return is still an open product question.

Related: [[tts-fixes]], [[edge-tts-webaudio-engine]], [[ios-tts-media-session-native]],
[[ios-sim-build-and-drive-workflow]], [[carplay-tts-support]]
