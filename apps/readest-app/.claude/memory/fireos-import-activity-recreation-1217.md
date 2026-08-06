---
name: fireos-import-activity-recreation-1217
description: "#1217 FireOS import no-op root cause: activity destroyed behind file picker -> Tauri re-init SIGABRT (fixed in tao 0.35, shipped v0.11.18) but picker result still lost; fix = own picker in native-bridge + pending-event replay"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0acea6f3-82e5-42fe-a526-8e36b2e6bbd2
  modified: 2026-08-06T06:10:11.846Z
---

# #1217 FireOS "Import Books does nothing" — root cause chain (researched 2026-08-06)

**Mechanism (confirmed via upstream tauri-apps/plugins-workspace#2745 logcat from a Fire 7):**
1. Import uses upstream `tauri-plugin-dialog` (`ACTION_GET_CONTENT`, DialogPlugin.kt still has `TODO: ACTION_OPEN_DOCUMENT ??`). Path: `page.tsx handleImportBooksFromFiles` → `useFileSelector.ts selectFileTauri` → `nativeAppService.selectFiles` → `openDialog()`.
2. Low-RAM FireOS destroys MainActivity while the picker is foreground. On return, Android recreates it **in the same process**; Tauri re-ran `tauri::Builder` → panic `PluginInitialization("log", "attempted to set a logger after the logging system was already initialized")` → SIGABRT. App silently relaunches; picked URIs vanish. Matches reporter's DevTools disconnect + `WM_RESTART_ACTIVITY` logcat.
3. Crash half fixed upstream in tao PR #1148 (tao >= 0.35.0, Oct 2025). Readest bumped tao 0.34.8 → 0.35.3 in 58d4661b7 (2026-07-13), first shipped in **v0.11.18**. All issue reports predate that.
4. **Still broken even with the fix:** on recreation the pending JS promise dies with the WebView, and Tauri's `PluginManager.onActivityCreate` early-returns (`if (::activity.isInitialized) return`) so its `ActivityResultLauncher` stays bound to the destroyed activity — the picker result has no callback and is dropped. Import silently no-ops instead of crashing.

**Repro without Fire hardware:** Developer Options → "Don't keep activities", then Import Books. **Does NOT work on Xiaomi/HyperOS (verified Xiaomi 13, 0.11.20, 2026-08-06):** (a) MIUI's GET_CONTENT picker (`com.android.fileexplorer/.picker.PickMainNavigatorActivity`) is a translucent sheet, so caller MainActivity stays PAUSED, never STOPPED → the option never fires; (b) HyperOS ignores `always_finish_activities` anyway (activity stayed STOPPED not DESTROYED after Home; no `mAlwaysFinishActivities` in dumpsys). **Working Xiaomi repro (result-loss verified):** open picker → Home → `adb shell am kill com.bilingify.readest` → resume task via recents (translucent picker forces MainActivity cold-recreate behind it, no crash on 0.11.20) → select file → OK → returns to library, book silently NOT imported; same file imports fine on an undisturbed round-trip. Confirms the lost-result half of the bug on process death; the in-process activity-recreation half needs a device that actually destroys activities (FireOS).

**FIX MERGED: PR #5531 (2026-08-06, squash commit 5b3f3e888 on main; worktree and branch removed):** native-bridge `show_file_picker` (ACTION_OPEN_DOCUMENT, request code 1003) + `deliverActivityResult` companion stash drained in `load()` + `file-picker-result` via emitOrQueue; JS `useAndroidPickedBooks` standing listener in library page feeds `importBooks`. **Xiaomi 13 device-verified:** kill-behind-picker now imports (0.11.20 dropped it); normal round-trip also verified. Gotchas: HyperOS rewrites OPEN_DOCUMENT to `hyper.intent.action.OPEN_DOCUMENT` (still fileexplorer picker); when driving the picker by adb ALWAYS verify "(1/100)" counter before OK — a missed selection tap looks exactly like the bug. FireOS-hardware verify still pending (in-process activity-recreation variant).

**Original fix direction:** own the file picker in `tauri-plugin-native-bridge` like the existing folder picker (`select_directory`, request code 1002): `ACTION_OPEN_DOCUMENT` + `EXTRA_ALLOW_MULTIPLE`, classic `startActivityForResult` handled in `MainActivity.onActivityResult` → `handleActivityResult`, `takePersistableUriPermission`, deliver via the existing `emitOrQueue` pending-event queue (already survives WebView reload; built for cold-start VIEW/SEND). JS: library page listens for a picked-files event on mount (like [[reader-feature-fixes]] useOpenWithBooks) instead of relying only on the in-flight promise.

**Related but separate findings:**
- Samsung "100+ MOBI selected, only 3 imported" (same thread, Nov 2025): different bug — `useFileSelector.ts` re-filters by extension after `basename()` resolution; failed resolutions fall back to raw-URI parse and get **silently dropped**; also unbounded `Promise.all` of one `basename` IPC per file. Needs its own issue.
- `src-tauri/src/android/eink.rs` EINK_MANUFACTURERS contains "amazon" → every Fire LCD tablet is treated as e-ink (contrast theme, no transitions, EPD refresh path). Cosmetic but wrong; worth separate fix.
- `NativeBridgePlugin.handleActivityResult` only handles FOLDER_PICKER_REQUEST_CODE (1002); REQUEST_MANAGE_STORAGE (1001) results are dropped.
