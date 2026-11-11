---
name: desktop-dev-window-webdriver-recipe
description: "Drive and screenshot the macOS `tauri dev` window when computer use can't see it (unbundled binary): webdriver feature on :4445 + screencapture -l"
metadata:
  node_type: memory
  type: reference
  originSessionId: 32c14265-55a6-4fd1-91f6-08462bed77dd
  modified: 2026-11-03T20:36:15.566Z
---

Computer use filters out `target/debug/Readest` (no bundle id), so it can't click or see the dev window.

- Run from a worktree with the main checkout's cache and a free port: `CARGO_TARGET_DIR=~/dev/readest/target pnpm tauri dev --features webdriver --config '{"build":{"devUrl":"http://localhost:3014","beforeDevCommand":"pnpm dev --port 3014"}}'` (Next 16 refuses a second dev server in the same dir; port 3000 may belong to another session).
- tauri-plugin-webdriver serves W3C WebDriver on 127.0.0.1:4445: POST /session, then /session/{id}/execute/async to run JS in the webview (click by selector, hook HTMLMediaElement.play / speechSynthesis.speak to observe audio).
- Library cards don't open on JS click; navigate with `location.href = '/reader?ids=<hash>'` (book file must be local under Books/<hash>/).
- Screenshot: window id via JXA `CGWindowListCopyWindowInfo` (owner pid of the binary), then `screencapture -x -o -l <id> out.png`. Visual modes by toggling `data-theme`, `data-eink`, `dir` on <html>; resize with System Events `set size of window 1`.
- The dev app uses the real data dir and session, but its localhost origin can't reach production (CORS): sync and Readest Voice catalog fail; seed `readest-voice-catalog` in localStorage to see Readest voices.

Related: [[tts-voice-preview-library]]
