---
name: tts-background-session-decoupling
description: Background TTS across book close (PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 97e57af9-5961-4c92-a63e-4582178bf798
---

Background TTS decoupling shipped as PR readest/readest#4941, MERGED 2026-07-06 (follow-up to merged #4931 Web Audio engine). Full e2e verified post-merge in Chrome dev-web including sleep timer firing headless (bar countdown chip → stop at 0:00), split view (parallel pane mount does not stop the playing session; pane close with keepTTSAlive keeps it), and bar-tap same-window reopen with live reattach.

Architecture: `TTSSessionManager` (per-webview singleton, keyed by book HASH — bookKey `${hash}-${uniqueId()}` regenerates per open) owns media bridge, keep-alive, sleep timer, headless persistence (via `setConfig`+throttled `saveConfig`; store setters no-op for closed books), and a deduplicated `tts-playback-state` relay (transit `'stopped'` swallowed; terminal stop only via `tts-session-ended` + `terminated` flag). `TTSController.detachView()/attachView()` re-seeds from `getLastRange()` via CFI anchor. `TTSMediaBridge` replaces `useTTSMediaSession`. Library `NowPlayingBar` reserves shelf clearance via `--now-playing-inset` body var.

**Close-path gotcha found live (not by tests):** the reader header X routes through `onCloseBook` → `handleCloseBook`, NOT `onGoToLibrary` → `handleCloseBooksToLibrary`. Any close-behavior change must cover BOTH. Eligibility is an explicit `keepTTSAlive` param on `saveConfigAndCloseBook`/`handleCloseBooks` (not a sticky ref): beforeunload/quit-app/window-close pass an event object which coerces to `false` → hard `tts-stop`; SPA closes pass literal `true` → `tts-close-book` (detach).

Verified in Chrome dev-web: WebAudio generation numbering continues across close→reopen (adoption, no new controller); different-book mount stops the session; pause/stop from the bar; headless position persisted. Related: [[page-turn-styles-viewtransitions-555]], [[edge-tts-word-highlighting-4017]].

Debug tip: `releaseUnblockAudio()` ("Unblock audio released" log) is called only from `handleStop`/`stopActive` — its appearance in the close flow pinpoints a hard-stop path.
