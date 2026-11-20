---
name: carplay-locked-cold-start-7566
description: "#7566 CarPlay pick with the iPhone locked waited for unlock; native Swift cold Read Aloud (port of Android #6341) + JS takeover; MERGED #7646 as 003c0be59 (2026-11-18); sim-verified only, no car test"
metadata:
  type: project
---

#7566 (iOS 26.5, 0.12.20, reporter lmartins18, who also wrote #7552 and has CarPlay on an iPhone 15 Pro Max): picking a book in CarPlay with the phone locked showed Now Playing with nothing playing until unlock. The first reply (card 7566, sent 2026-11-18) called it a feature request; the owner then chose to build it.

**Fix:** PR #7646, MERGED 2026-11-18 by the owner as 003c0be59 (head 3b7687852, after four CodeRabbit rounds); worktree and branch removed. Card `7566-2` was DROPPED by the owner, so no issue reply was posted; the issue is closed.
- Review-driven changes:
  - narrated books (spine Media Overlays or a config `audiobook`, with `ttsUseNarration` on) and App Lock (`settings.json` `pinCodeEnabled`) keep the reader path;
  - skip while paused stays paused, and the driver's Pause cancels an interruption resume;
  - DEFLATE goes through `compression_stream`, which must reach END at the declared size;
  - the JS handoff calls `clearBookProgress` before `initViewState`. Without it, a playing handoff into an open reader started from the old page and never played: caught in the sim.
- `initViewState` RETHROWS after recording the error; catch it.
- `CarPlaySceneDelegate` posts `readestCarPlayPlayBook` with an NSMutableDictionary. NativeTTSPlugin sets `handled` when the phone's UIWindowScene is off screen, the reader isn't playing (`webViewPlaying`), and `Books/<hash>/*.epub` exists under Application Support/<bundle id>/Readest. Otherwise the old deep-link path runs.
- `ColdEpubText.swift`: a port of ColdEpubText.kt (zip via Compression, DOM via XMLParser, UTF-16 offsets) plus `resumeCfi`, which mirrors isCfiInLocation. `ColdReadAloud.swift`: AVSpeechSynthesizer, writes `location` + `viewSettings.ttsLocation` + `updatedAt` per chunk.
- `triggerMediaSession` routes remote commands and interruptions to the native player while it's active. The native player always owns a fresh media session.
- JS `CarMediaLibraryBridge` (iOS, not behind App Lock) calls `take_cold_playback` on mount and on every `visibilitychange` to visible. For each open copy of the book it calls `clearBookProgress` and then `initViewState` with that pane's own `isPrimary`. It dispatches `readest://book/<hash>?autoplay=tts` if the player was playing.

**Verified only in the sim**, with WebContent SIGSTOPped to stand in for the lock and a temporary Darwin-notify hook standing in for the tap (recipe: [[ios-sim-build-without-matching-runtime]]). Not run: real car / CarPlay Simulator, cold launch from CarPlay, interruptions. Audiobook picks still have the old suspension problem (not covered).

**How to apply:** a CarPlay report after this release: check whether the pick took the native path (`ColdReadAloud` log category) or the reader path (narrated book, audiobook, App Lock, phone on screen, reader playing). Never run in a real car; if lmartins18 or anyone confirms on a device, record it here. Related: [[carplay-interruption-resume-6444]], [[carplay-hidden-app-music-stops-7168]].
