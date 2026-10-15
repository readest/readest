---
name: ios16-sharekit-url-parse-6719
description: iOS 16 share sheet never opened for paths with spaces/non-ASCII (sharekit URL(string:)); stale <tmp>/<name> copy on re-share
metadata:
  type: project
---

#6719 (2026-10-14): iPadOS 16 "Exported successfully" but no share sheet/file. MERGED #6770 (bb55cda8b) UNRELEASED; NOT verified with a full app build on an iOS 16 device.

- tauri-plugin-sharekit 0.3.1 iOS `shareFile` does `URL(string: args.url)`. On iOS 16 that is nil for a space or non-ASCII char (iOS 17+ auto-encodes) → rejects "Invalid file URL". `NativeAppService.saveFile` swallows every share rejection as a cancel and returns true → false success toast. It hit every iOS share (annotations, book Send, quote card, image).
- The plugin also `try? copyItem`s to `<tmp>/<lastPathComponent>` and silently keeps an existing copy, so a re-share of the same name sent the OLD file (all iOS versions).
- Fix (iOS only): pass `file://` + per-segment `encodeURIComponent`, and `remove` the `<Temp>/<name>` copy first. macOS's plugin uses `fileURLWithPath` → it must keep the bare path. Android accepts `file://`.
- An iOS "Open with" book keeps a DECODED `file://` URI as `book.filePath` (useOpenWithBooks), so `saveFile` strips that prefix before encoding. Never decode it again: a literal `%` in a filename would break (CodeRabbit fix, 4514c5a3f).
- Repro without the app: compile a Swift snippet with `xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios16.0-simulator`, then `xcrun simctl spawn <iOS16.4 device> ./bin`. An iOS 16.4 sim runtime is installed.
- In worktrees run single files via `pnpm exec dotenv -e .env -e .env.test.local -- vitest run <file>`. Bare `npx vitest` lacks env (supabase atob crash). `pnpm test -- <file>` runs extra files.

Related: [[platform-compat-fixes]]
