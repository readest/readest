---
name: library-progress-lost-on-quit-6623
description: "#6623 shelf % stale after quit: #4556 defers library.json 30s; close/quit handlers never awaited (throttle returns void); fix in worktree fix/library-progress-on-close, UNCOMMITTED"
metadata:
  node_type: memory
  type: project
  originSessionId: 7f7759e7-558c-466a-8b00-88976ae25821
  modified: 2026-10-04T16:26:06.108Z
---

#6623 (Windows): open EPUB from Explorer, read, close the reader window (= app quits), relaunch → library card shows the old %.

ROOT (verified on installed macOS 0.12.10 via Cmd+Q, 2026-10-05): config.json had 29/39, library.json 27/39, card showed 69%.
- `bookDataStore.saveConfig` writes config.json eagerly but library.json through a 30s throttle (#4556, perf). Only flushed by useProgressAutoSave unmount (fire-and-forget) — nothing flushes on quit/window close. Library load never reconciles progress from config.json (the #4556 comment claiming it does is false).
- `ReaderContent.handleCloseBooks` was `throttle(...)`, and throttle returns void, so `tauriHandleOnCloseWindow` and `tauriQuitApp` (`await dispatch('quit-app')` then `exit(0)`) never waited for the save.
- On macOS the X in the reader for an open-with book hides the main window (close-to-hide), app stays alive and the unmount flush lands. That's why it's Windows/Linux-visible; on macOS only Cmd+Q reproduces it. After that hide, reopening via the Dock shows a BLANK window (reader route, no books), a separate bug, not filed.
- Side effect seen: desktop open-with of an already-imported book rewrites its `filePath` to the external file (importBook transient branch).

FIX MERGED #6633 (f0ca5c975) UNRELEASED: `await flushPendingLibrarySave()` in ReaderContent `saveBookConfig`, and handleCloseBooks became an in-flight-deduped promise. Test: `src/__tests__/app/reader/reader-content-close-saves-library.test.tsx`. Dev build VERIFIED 2026-10-05 (macOS, open-with via CLI arg): Cmd+Q 4s after a jump, and Cmd+Q right after page turns (before the autosave debounce), both left config.json == library.json; shelf showed 62% = 24/39.

Dev-build traps: port 3000 held by another worktree's next dev → `next dev -p 3001` + `pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:3001","beforeDevCommand":""}}'`, then kill it and run `<wrapper>.app/Contents/MacOS/Readest file.epub` (`open -a wrapper.app` gave NO window). The new origin has no session, so with `keepLogin` true the library bounces to /auth, and the auth page's back button WRITES keepLogin=false into the shared settings.json. Restore it afterwards.

Repro recipe: back up library.json, `open -a /Applications/Readest.app <copy>.epub`, turn pages, wait 4s, Cmd+Q within 30s of the first save, then compare `Books/<hash>/config.json` with the library.json row.

FOLLOW-UP UNPUSHED: CodeRabbit found that a throttled library save already in flight was not awaited, and overlapping saves could land out of order. Fixed with a save queue + flush waiting on the in-flight save, commit 8d3d86682 on LOCAL branch `fix/serialize-library-saves` (based on pre-squash ec3192d75, so rebase onto main before pushing). Not pushed because chrox merged #6633 first.
