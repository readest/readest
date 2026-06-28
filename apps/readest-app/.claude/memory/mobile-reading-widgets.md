---
name: mobile-reading-widgets
description: "Home-screen reading widgets (#1602, PR"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7f7f8218-4656-4863-972e-ea6204c130fa
---

Mobile home-screen reading widgets (issue #1602, merged PR #4842). Code lives in the **native-bridge plugin**: `src-tauri/plugins/tauri-plugin-native-bridge/{android,ios}/` (Android `ReadingWidgetProvider.kt` + `res/`; iOS writer `ReadingWidgetWriter.swift`) and the iOS WidgetKit extension at `src-tauri/gen/apple/ReadestWidget/`. App publishes a snapshot + downsized cover thumbnails via the `update_reading_widget` command to iOS App Group `group.com.bilingify.readest` / Android `SharedPreferences`. Widget hook: `src/hooks/useReadingWidget.ts`; payload builder `src/services/widget/readingWidget.ts`; tap opens `readest://book/{hash}` via `useOpenBookLink.ts`.

Durable, non-obvious gotchas (each cost a debugging round):

- **iOS widget missing from gallery = stale `.xcodeproj`.** `gen/apple/project.yml` defines the `ReadestWidget` target, but **Tauri's iOS build does NOT re-run xcodegen**, so a newly-added target is silently omitted from the build. Fix: `cd src-tauri/gen/apple && xcodegen generate`. Also: iOS builds from the **MAIN repo** `/Users/chrox/dev/readest` (complete gen/apple), NOT the `pnpm worktree:new` worktree (its gen/apple is incomplete — missing `Sources/`, `Assets.xcassets`, `Externals`, `LaunchScreen.storyboard` — so xcodegen fails there).
- **Android RemoteViews allow only @RemoteView widgets.** Plain `<View>` (and `<Space>`) is NOT allowed → launcher inflate fails → "Can't load widget". Use an empty `FrameLayout` for spacers. Covers: badge + progress bar are **baked into the bitmap** (Canvas in `writeThumbnail`) because RemoteViews can't clip/overlay reliably; shown via `fitCenter`. Responsive sizing by grid cells: `n = (minWidthDp + 30) / 70` (Android cell formula); one book per column, cap 3.
- **Background TTS progress freeze.** `book.progress` (libraryStore) AND `readerProgressStore` are both written by the same `setProgress`, inside `commitRelocate` → **`requestAnimationFrame`**, which Android pauses for a backgrounded WebView → both freeze during background TTS. No store-only fix (page-based progress needs rendering). Fix: in `FoliateViewer.progressRelocateHandler`, commit synchronously when `document.visibilityState === 'hidden'` (relocate still fires; only the rAF commit was deferred). Confirmed working on device.
- **iOS TTS controls deferred** — interactive widget buttons need iOS 17 App Intents; widget min target is iOS 15 (15/16 widgets can only deep-link, no buttons). Android uses `MediaButtonReceiver.buildMediaButtonPendingIntent` (any version). Follow-up only.
- **`.superpowers/` is NOT gitignored** in this repo → a subagent's `git add` can sweep SDD scratch (`*-report.md`) into a commit; check `git ls-files '.superpowers/*'` before squashing/pushing.

Related: [[android-nativefile-remotefile-io]] · [[tts-fixes]] · build/worktree [[feedback_use_worktree]]
