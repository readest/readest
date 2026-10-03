---
name: carplay-interruption-resume-6444
description: "#6444 CarPlay audiobook never resumed after a nav prompt; resume relied on JS that may be suspended; native restart b3f0e47d3 SIM-VERIFIED via synthetic interruption + SIGSTOP WebContent; sim has NO cross-app interruptions"
metadata:
  node_type: memory
  type: project
  originSessionId: ffbf6433-318f-4961-ba3f-5cd2e1cd0e83
  modified: 2026-09-29T05:21:00.142Z
---

#6444 (iOS 26.6.2, 0.12.10): after a CarPlay navigation prompt interrupted an audiobook, playback did not resume.

The native interruption handler in `NativeTTSPlugin.swift` already existed (#5085). On `.ended` with `.shouldResume`, though, it ONLY sent `media-session-play` to JS. The fix's premise, NOT proven on a device: an ABS audiobook on iOS plays entirely through the native playout AVPlayer, so the WebView content process can sit suspended in the background and the forwarded pause and play events just queue up. The fix: on `.ended` with shouldResume, if `playoutPlaying` is still true (JS never ran the pause), `playoutCurrentIndex != -1`, and the player rate is 0, restart the player natively and resume the keep-alive. The same path covers a `.began` that the 2s self-op window ignored. The index `-1` guard stops a finished Edge item from replaying its end during the gap timer, which would advance twice.

Worktree + branch fix/carplay-interruption-resume-6444 REMOVED 2026-09-29; commits 317ff5f14 + 83bf50709 (CodeRabbit fix). PR #6462 MERGED 2026-09-29 as d3cd0ac5e, UNRELEASED (device verify still PENDING).

**How to apply:** verify on a device by starting an audiobook, locking the phone, then triggering Apple Maps voice guidance or Siri. Check `[TTSKeepAlive] interruption ended ... native=true`. Type-check recipe: copy the plugin's `ios/` plus the main checkout's `.tauri/` into scratch, then run `xcodebuild -scheme tauri-plugin-native-tts -destination 'generic/platform=iOS'`. Related: [[ios-tts-media-session-native]].

**Sim verification 2026-09-29 (iPhone 17 Pro, iOS 26.3), with the Goodnight Moon Media Overlay EPUB (`~/Documents/books/issues/641/`), which uses the same native `load` playout path as ABS.**
- The SIMULATOR DELIVERS NO CROSS-APP AUDIO INTERRUPTIONS. A helper app using `.voicePrompt` + `interruptSpokenAudioAndMixWithOthers`, or even a solo non-mixable `.playback` session, left Readest playing straight through.
- In the sim, Readest's JS kept polling while backgrounded behind the helper app, so JS suspension in the sim is NOT automatic.
- Technique that worked:
  - A temporary Darwin-notify hook in the plugin (`xcrun simctl spawn <U> notifyutil -p readest.debug.began|ended`) pauses the player like iOS does and posts `interruptionNotification` with `.shouldResume`.
  - `kill -STOP` on the sim's single `com.apple.WebKit.WebContent` process emulates iOS suspending the web process.
  - A runtime flag forces the old path, so one build gives both before and after.
- Results:
  - OLD path with WebContent stopped: rate stays 0. Nothing resumes until SIGCONT flushes the queued pause and play.
  - NEW path: `native=true`, rate goes back to 1.3 and time advances.
  - JS alive: `native=false`, and the JS play path resumes as before.
- Headless driving when computer-use is locked:
  - A temporary `VerifyRelay` component polls `http://127.0.0.1:8765` (CSP `connect-src http://*:*` allows it) and exposes `window.__v`.
  - Import the book as a `File` fetched from the relay. A path in the app container fails with "forbidden path" (fs scope).
  - Start narration with `tts-speak`; rewind with `document.querySelector('foliate-view').goToFraction(0)`.
- A fresh worktree's `gen/apple` lacks gitignored files (Info.plist, Assets). Fix: `rsync -a --ignore-existing --exclude build --exclude Externals` from the main checkout. Use `pnpm exec dotenv`, because the ruby gem `dotenv` shadows it on PATH.
- STILL UNPROVEN: that the real device actually suspends WebContent during CarPlay playback. It's the likely cause, but only a device log can confirm it.

**CarPlay sim re-run 2026-09-29 (computer use, CarPlay display attached, Readest started FROM the CarPlay Recent Books list, then phone Home -> backgrounded).**
- The sim NEVER suspends Readest's JS with CarPlay attached. The poll age stayed under 1s for 60s while playing AND for 45s while paused in the background. The sim cannot show whether a device suspends it.
- OLD path + WebContent frozen: CarPlay keeps showing a PAUSE button (playing) frozen on the last word while the player sits at rate 0. The car claims playing over silence, which matches the report. Audio returns only after SIGCONT (17s of silence).
- NEW path + frozen: `native=true`, audio played continuously while frozen (13.64s -> 25.10s over 8.8s at 1.3x); after SIGCONT CarPlay caught up.
- JS alive: `native=false`, CarPlay showed paused during the interruption and playing after.
- TRAP: `pgrep -f com.apple.WebKit.WebContent | head -1` can hit a HOST macOS WebContent (it froze a Mac app's). Use `pgrep -f "CoreSimulator.*WebKit.WebContent"`.
- CarPlay window: the osascript I/O > External Displays > CarPlay click takes several seconds to show a window, and its first frames are black. Move it with System Events `set position`.
- Stale `~/.claude/computer-use.lock`: `/clear` keeps the lock under the old sessionId while the same claude PID lives on. Deleting the lock (user-approved) freed it.
- Media Overlay resume after SIGCONT once rewound to JS's last clip (about 12s); not reproduced on the next run.
- The sim's Device > Siri (it shows on CarPlay) does NOT interrupt Readest. Siri logs `_scheduleInterruptedAudioResumingIfNeeded`, but Readest gets no interruptionNotification and keeps playing. A real interruption needs a device.
- The clipped second line on CarPlay Now Playing (the artist field: author, or the section label in sentence mode) is a TRANSIENT redraw glitch in the iOS 26.3 sim. The same strings later rendered cleanly, so it's not Readest's metadata.
- Same result with Edge TTS (Alice, per-sentence playout): Siri on CarPlay produced no interruptionNotification and TTS kept playing. Audiobook vs TTS makes no difference; both share one spoken-audio session and the sim never arbitrates sessions between apps.
- CodeRabbit (PR #6462) was right: `start-session` sets `playoutPlaying=true` BEFORE a continuous item is ever played, so `playoutPlaying` alone restarted a loaded-but-never-played item after an interruption (sim-reproduced: 0 -> 3.58s). Fix 83bf50709 = `playoutStarted` flag, set by resume/Edge advance and cleared by pause/abort. Don't use a rate snapshot at `.began` (the player may already be paused by then). Sim probe recipe: relay invoke `set_media_session_active` + `start-session` + `load` (file in the app container's tmp) without `resume`. The reusable temp patch is `scratchpad/apply-temp.py` (session-scoped).
