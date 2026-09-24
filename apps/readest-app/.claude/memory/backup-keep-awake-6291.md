---
name: backup-keep-awake-6291
description: "#6291 Android backup/restore: screen sleep fix (useScreenWakeLock in BackupWindow) + bulk zip moved to Rust (write_backup_zip/extract_backup_zip) because Android IPC request bodies are JSON number arrays at 3.9 MB/s; old restore OOM-killed the app at 5.7 GB RSS; Xiaomi+macOS VERIFIED; MERGED #6299 (f521de63e) 2026-09-19"
metadata:
  type: project
---

Issue #6291 (2026-09-19, Android 16, 0.12.8): local backup is very slow with
a big library and stops when the screen turns off. chrox: verify on Xiaomi,
profile backup+restore, make it more performant.

**Fix 1 - keep awake:** `BackupWindow.tsx` calls the reader's
`useScreenWakeLock(isProcessing, appService?.hasWindow, appService?.isIOSApp)`
while status is backing-up/restoring. Xiaomi-VERIFIED via
`adb shell dumpsys window | grep mHoldScreenWindow` (= MainActivity while the
progress bar runs, `null` after) + `dumpsys power` SCREEN_BRIGHT_WAKE_LOCK ws=readest;
screen_off_timeout forced to 15 s mid-backup -> still `mWakefulness=Awake` 40 s later.
The SAF save picker opens BEFORE the zip is written; the hook re-acquires on return.

**Fix 2 - performance (the real bug):** measured on the Xiaomi 13, 166 files /
720 MB library, via CDP `Runtime.evaluate` on a `pnpm dev-android` build:
- IPC `plugin:fs|read_file` 195-289 MB/s, asset fetch 295 MB/s -> reads were fine.
- IPC `plugin:fs|write_file` of 4 MB raw = **3.9 MB/s**. Cause: `ipc-protocol.js`
  never uses the custom protocol on Android (`shouldInterceptRequest` has no body),
  so `process-ipc-message-fn.js` turns every Uint8Array into `Array.from()` JSON.
  The old backup streamed 1 MB zip chunks through `plugin:fs|write` = 177 s;
  the old restore `writeFile`d each entry the same way AND buffered whole
  entries -> RSS 5.2->5.7 GB (HyperSentinel), `am_proc_died` at +80 s. It never finished.
- New: `src-tauri/src/backup_zip.rs` `write_backup_zip(dest, entries[{name,path|content}], Channel)`
  and `extract_backup_zip(src, entries[{name,dest}], Channel)`; `zip` crate 2.4 (already a dep),
  Stored for books / Deflated for JSON (same shape as zip.js output), `spawn_blocking`,
  `tauri_plugin_fs::FsExt::fs().open(FilePath)` so a `content://` picker URI works
  on both sides, `transfer_file::ensure_path_allowed` on plain paths. Registered in
  lib.rs + build.rs AppManifest + both capabilities (see [[app-command-acl-manifest-6253]]).
  JS: `collectBackupEntries` planner shared by zip.js (web) and the native path;
  `createBackupZipToFile` tries native first and falls back to the old stream on
  error (a non-seekable SAF provider fails on the first seek before writing);
  `restoreFromBackupZip(..., source)` collects bulk entries, merges existing
  config.json in JS, extracts natively, then imports orphans; falls back to
  per-file writeFile (web / native failure). `BackupWindow` passes `result.files[0]?.path`.
- Result on the Xiaomi: backup 720 MB **177 s -> <3 s** (direct command timing
  0.9-1.7 s, 435-795 MB/s); restore **killed at 80 s -> 5 s** incl. the 720 MB
  content-URI copy to cache, RSS ~500 MB. Native zip = same entry set, sizes,
  CRCs, identical library.json (`python zipfile` diff vs the zip.js baseline);
  restored books hash-identical (SHA-256 via `fetch(convertFileSrc)` + subtle.digest).

**macOS (release build, Apple Silicon, scratch library 760 MB / 354 files after
the restore; measured 2026-09-19 by a temporary in-app probe under a scratch
identifier `--config '{"identifier":"com.bilingify.readest.bench"}'` so the real
1.5 GB library was never touched):** backup old stream 86.3 s -> native 1.5-1.8 s;
restore old 3.9 s -> native 1.6-1.9 s (into empty: 1.9 s). Primitives: streamed
`plugin:fs|write {rid,data}` 8x1 MB = 883 ms (~9 MB/s: the chunk sits INSIDE a JSON
object, so the number-array replacer runs on desktop too), `write_file` raw body
8 MB = 25 ms (320 MB/s, custom protocol), `read_file` 8 MB = 5 ms. So desktop
restore was only 2.4x slow (raw-body path) while desktop backup was 50x slow.
Probe mechanics: macOS has NO CDP; Next `[browser]` console forwarding did NOT
show the app's console.log in the `tauri dev` log, so the probe wrote its lines
to `$APPDATA/bench6291.log` via `appService.writeFile`; WKWebView defines
`__TAURI_INTERNALS__.invoke` read-only ("Attempted to assign to readonly
property"), so forcing the JS fallback needed a temporary flag inside
`invokeZipCommand`, not a monkeypatch. The bench identifier's app-data, Caches,
WebKit dirs were deleted afterwards; all bench code reverted.

**Gotchas:** `pnpm test -- <file>` runs the WHOLE suite (the `--` is eaten);
use `pnpm exec dotenv -e .env -e .env.test.local -- vitest run <file>` (bare
`vitest` lacks the env and `utils/supabase.ts` throws on `atob(undefined)`).
zip.js `Entry = DirectoryEntry | FileEntry` and only `FileEntry` has `getData`;
`entries.filter(e => !e.directory)` narrows via TS 5.5 inferred predicates, so
helper params must be typed `FileEntry[]`. Duplicate entry names make the `zip`
crate return "Duplicate filename" (the planner already excludes root files).
`adb install -r` KILLS the running app -> re-forward CDP (new pid socket).
Cargo `target` is shared across worktrees: a build in another worktree blocks
yours ("waiting for file lock on build directory"). MIUI's picker
(com.android.fileexplorer) lists recent files: tap the row, then OK (838,2204)-(1025,2303);
the SAF save picker's SAVE is at (799,2268)-(1041,2400).

Status: MERGED #6299 as f521de63e on 2026-09-19 (4 commits: 3 bisectable 5794a579d wake lock /
2745ce14d Rust commands / 7736cb4b7 TS switch-over; full suite 11350 green,
lint/format/fmt/clippy clean). /ship pre-landing review (3 subagents) found and
I fixed: `file://` dest/src bypassed `ensure_path_allowed` (FilePath parses it as
Url) -> now scope-checked, only content:// exempt; extraction truncated the live
book before reading -> `.part` + rename; API now `src_dir`/`dest_dir` + relative
names validated by `validate_entry_name` (one scope check, no host separators in
Rust); all-books-unreadable backup now errors instead of "completed" with an
empty archive; `.part` leftovers excluded from backups; iOS security scope
released; restore progress was lost for the merge/import phases -> one total
across merge+extract+import; native backup progress mapped onto the dialog's
book-file contract. NOT device-verified after the hardening (phone unplugged;
final APK built in the worktree if it returns). Known gaps: backup zip.js
fallback has no unit test (exercised on macOS via the forced fallback);
Android/iOS copy the picked zip to cache AND Rust reads the original URI (2x I/O).
`gstack-redact` bin is NOT installed here (the /ship PR-body scan is skipped).
CodeRabbit round 1 (5 comments): FIXED symlink-under-Books escape (canonical
parent must start_with canonical dest_dir + `.part` via create_new) and
config.json written only AFTER extraction (3b7a70bae); DECLINED staging the
backup archive (OS save dialog = user-consented overwrite; content:// can't be
renamed onto; sibling temp not in fs scope), per-file skipped-file UI (follow-up;
all-unreadable now errors), and "Windows rename fails when dest exists" (FALSE:
std uses MoveFileExW MOVEFILE_REPLACE_EXISTING, verified in rustc 1.92 std src).
Reply to review comments via `gh api repos/readest/readest/pulls/6299/comments/<id>/replies -F body=@file`.
The comment monitor must dedupe by id: CodeRabbit EDITS its comments, so a
`?since=` poll re-emits them.
Worktree and branch removed after merge (`pnpm worktree:rm` leaves the local branch; delete it by hand).
