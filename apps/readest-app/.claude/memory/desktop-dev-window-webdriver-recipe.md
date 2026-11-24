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

- **Clean library without touching the real one (2026-11-18, #7150):** `CARGO_HOME=~/.cargo RUSTUP_HOME=~/.rustup CARGO_TARGET_DIR=~/dev/readest/target HOME=<scratch>/fakehome CFFIXED_USER_HOME=<scratch>/fakehome pnpm tauri dev --features webdriver --config '{"identifier":"com.bilingify.readest.test7150"}'`. The identifier override is required while /Applications/Readest.app runs: single-instance uses a fixed `/tmp/<identifier>_si.sock`, so the dev build otherwise hands off and exits 0. Data lands in `fakehome/Library/Application Support/<identifier>/Readest/Books/library.json` (has `originalFilename`, `metaHash`).
- **Import from Folder without the native picker:** set `localStorage['readest:lastImportFolder']`, click Import Books → From Directory → OK. The path must be in fs_scope or readDirectory fails "forbidden path"; the executable dir (`target/debug`) is allowed at startup, so stage books in `target/debug/<dir>` and delete after.
- **Shared target dir gotcha:** if a deleted worktree last built the local plugins, tauri-build panics "failed to read plugin permissions …/readest-pr-NNNN/…". Fix: `cargo clean -p <plugin>` for each dir in `src-tauri/plugins/`.

Related: [[tts-voice-preview-library]]
