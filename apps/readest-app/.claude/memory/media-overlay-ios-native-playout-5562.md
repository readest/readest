---
name: media-overlay-ios-native-playout-5562
description: "PR #5562 routes Media Overlay narration through the iOS native playout AVPlayer; review found a silently-killed user setting, an orphaned rolling audio element, and a missing error channel"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d216451-c0db-46b1-ade0-eb583099d350
  modified: 2026-08-08T09:08:59.722Z
---

PR #5562 (Juansero29), the iOS follow-up to [[media-overlay-narration-5480]]. MERGED
2026-08-08 as `9b50ceeb9` — squashed, and byte-identical to the reviewed tree across every TTS
path. On iOS Tauri
`HTMLAudioElement` is cut off ~0.5s after `play()` because `TTSMediaBridge` claims the app's
non-mixable `.playback` session — the same constraint that moved Edge TTS to `NativeAudioPlayer`.
Fix: `NativeNarrationPlayer` stages the chapter blob to a temp file and drives the shared
`playout` AVPlayer via new `load` / `seek` actions. Large MO clips must never cross the plugin
as base64. Reviewed and fixed 2026-08-08.

**The trap worth remembering: a lock-screen "improvement" silently killed a user setting.**
The PR replaced `#updateMetadata`'s `buildTTSMediaMetadata(...)` call with a hardcoded
`title — chapter` and `shouldUpdate: true`. `ttsMediaBridge.ts` was that function's ONLY
production consumer, so Settings > TTS > Media Info > **Update Frequency**
(Every Sentence / Paragraph / Chapter) kept rendering and persisting while doing nothing, on
every platform — and chapter mode went from one native metadata IPC per chapter to one per
sentence. Tell: `rg <helper> src/ --glob '!src/__tests__/**'` returns only the definition.
Whenever a change hardcodes what a setting used to choose, grep for the setting's remaining
consumers before accepting it. Restored, with a test that asserts the MODE drives the output
rather than pinning one shape.

**`invalidatePlayback()` must pause before dropping the clock.** It calls `#cancelHandover()`,
which kills the timer whose only job is to silence a recording deliberately left rolling for
the next block, then nulls `#audio`. Native was fine (`invalidateSession()` invokes pause);
web/Android/desktop leaked. Reachable because the controller transits `'stopped'` during a
paragraph advance, so `handleSetVoice` skips its `stop()` and the recording plays on under the
engine that took over.

**`NativeNarrationPlayer` had no error channel at all.** `#errorListeners` was populated by
`#waitUntil` but nothing ever fired it, and Swift never observed failure. A staged file that
could not be decoded left `speak()` waiting on a clock that was never going to move: no error,
no auto-advance, no UI. Fixed with `AVPlayerItem.observe(\.status)` + `AVPlayerItemFailedToPlay
ToEndTime` -> `emitPlayoutEvent("error")`. Guard it on `playoutLoadedPath != nil` and null that
in `playoutAdvance`, or a stale MO observer fires during Edge playback.

**Verification reality:** `NativeTTSPlugin.swift` is compiled by NO CI job and by none of
`pnpm lint` / `test` / `fmt:check` / `clippy:check` / `test:rust`. `xcrun swiftc -parse <file>`
syntax-checks it standalone, and a snippet through `xcrun swiftc -typecheck` validates an API
pattern (used to confirm the KVO key path) without the Tauri headers. Real proof needs
`pnpm tauri ios build`, which does compile it — verified green on dev, IPA at
`src-tauri/gen/apple/build/arm64/Readest.ipa`. Building compiles the Swift; it says nothing
about narration surviving past 0.5s. See also [[tts-fixes]], [[edge-tts-tauri-ws-hang-5230]].

**Bare `dotenv -e .env.tauri -- ...` outside a pnpm script resolves to the Ruby gem**
(`~/.gem/bin/dotenv`, "invalid option: -e"), not `dotenv-cli`. Use `./node_modules/.bin/dotenv`
or go through the package script.
