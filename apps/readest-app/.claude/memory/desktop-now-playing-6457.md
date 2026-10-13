---
name: desktop-now-playing-6457
description: "#6433 media key can't resume TTS (MERGED #6452) + native desktop Now Playing via souvlaki (PR #6457 OPEN); WKWebView never becomes Now Playing; souvlaki macOS set_metadata flashes blank cover"
metadata:
  node_type: memory
  type: project
  originSessionId: 9f094849-4987-4325-bf24-4102c13b6ab8
  modified: 2026-09-29T11:40:58.636Z
---

**#6433** (Windows play/pause key pauses TTS but never resumes): Chromium's
`MediaSessionImpl::GetMediaSessionInfoSync` lets `playbackState` force only
PLAYING, never PAUSED while a normal player is active, so the looping silent
keep-alive made every key press a `pause`. Fix MERGED #6452: pause the
keep-alive with TTS (web media-session path).

**Native desktop Now Playing** PR #6457 (branch feat/desktop-now-playing,
2026-09-29), OPEN:
- `tauri-plugin-native-tts/src/now_playing.rs` on `souvlaki` 0.8 (zbus
  backend); desktop plugin implements `register_listener`/`remove_listener`
  so `addPluginListener` works unchanged (registered ONLY on desktop via a
  `handler!` macro, else it shadows the mobile native plugin; a `let handler =
  generate_handler![..]` fails type inference, pass it straight to
  `invoke_handler`).
- All controls on the main thread (`run_on_main_thread` + thread_local):
  Windows SMTC is thread-bound COM.
- macOS: WKWebView NEVER becomes the Now Playing app (media key launched
  Music.app, before and after #6452). Native session fixed it: hardware key
  pause/resume VERIFIED on macOS dev build.
- souvlaki macOS `set_metadata` REPLACES the nowPlayingInfo dict and reloads
  the cover async -> widget flashed a gray cover every sentence (chrox saw it).
  Fixed by merging metadata via `objc2-media-player` and keeping the
  `MPMediaItemArtwork`; souvlaki `set_playback` already merges.
- Desktop Tauri no longer creates the keep-alive element.
- Windows only `cargo check`ed; Linux not built locally (GTK cross deps);
  Flathub needs `--own-name=org.mpris.MediaPlayer2.readest`.
- Open gap: audiobook/Media Overlay `<audio>` may still get a WebView2 SMTC
  entry on Windows.

**Verify traps:** `t` toggles Read Aloud, so pressing it twice starts then
stops (looked like "t does nothing"). Clicking near the TTS bar turns pages
and moves the saved reading position. Webview console isn't in the app log;
temporarily forward `console.*` via `invoke('plugin:log|log', {level,
message})` to `~/Library/Logs/com.bilingify.readest/Readest.log`. Hardware
media key on macOS: post an NX_KEYTYPE_PLAY (16) systemDefined NSEvent from
a tiny Swift binary. Uses [[computer-use-tauri-dev-binary-no-bundle-id]].
