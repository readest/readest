---
name: macos-paired-audiobook-asset-range-cap-6848
description: "#6848 macOS paired M4B silent: moov atom past byte 1,024,000 (Tauri asset protocol MAX_LEN); MERGED #7037 (e2486ecbc, 2026-10-24) UNRELEASED: desktop paired audio + preview go through the media proxy; Windows/Linux unverified"
metadata:
  type: project
---

Root cause, reproduced 2026-10-24 on main 1923204fe (macOS dev build) with the reporter's files in `~/Documents/books/issues/6848/`. Desktop played paired audio via `convertFileSrc`, and Tauri's asset handler caps each range response at `MAX_LEN = 1000 * 1024` (`packages/tauri/crates/tauri/src/protocol/asset.rs`). WebKit gives up when the `moov` atom is bigger than that. `-c copy -movflags +faststart` cuts played up to a moov ending at 1,004,154 and failed from 1,035,194. iOS/Android use native players and web uses a blob, so they are unaffected. Images are fine: plain GETs skip the range branch, and `RemoteFile.fetchRange` already splits at 1,024,000.

Fix: MERGED #7037 as e2486ecbc on 2026-10-24 (worktree removed). `getLocalMediaUrl(path, type)` in `services/audiobook/mediaProxy.ts` stats the file and calls `get_media_file_url(path, 0, size)`. It's used by TTSController's paired `resolveUrl` and `preview.ts`, falling back to `convertFileSrc`. Verified on macOS: preview and Read Aloud audible, playback heard at 5:14 of the 6:29 file. NOT run: Windows, Linux CEF.

Still open: offline-downloaded ABS books on desktop (`openAudiobook.ts:230`) still use `convertFileSrc` and likely have the same bug. Its `resolveUrl` is sync, so the fix needs a separate change.

Test gotchas:
- big-test.m4a is a steady 440 Hz tone, not speech.
- In this dev build, clicks often land one event late. Clicks near the bottom edge can hit the Dock and bring another app forward.
- Pairing copies the audio to `Books/<hash>/audiobook/`, and "Remove" deletes that copy.

Related: [[narration-ios-file-window-6989]], [[computer-use-tauri-dev-binary-no-bundle-id]], [[macos-narration-audio-capture-recipe]].
