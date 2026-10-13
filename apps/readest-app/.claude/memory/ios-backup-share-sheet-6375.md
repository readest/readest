---
name: ios-backup-share-sheet-6375
description: "#6375 iOS Backup stuck at 0% / 0 KB zip: iOS save-dialog URL (.exportToService) is NOT writable (EPERM); zip.js fallback hung on TransformStream backpressure; fix = stage in Temp + share sheet; MERGED #6486 (dbdc2f0d4) UNRELEASED; iPad share-flow verify PENDING"
metadata:
  node_type: memory
  type: project
  originSessionId: 2da4d9df-5765-4262-bbfa-dd1657e0cca5
  modified: 2026-09-29T19:16:14.607Z
---

#6375 (2026-09-30, iOS 26, 0.12.10): Backup Library stuck at 0%, 0 KB zip created.

**Root cause (reproduced on iPad, iPadOS 27):** tauri-plugin-dialog's iOS `save` creates an empty
file in Documents and exports it via `UIDocumentPickerViewController(url:in: .exportToService)`;
the returned `file://.../File Provider Storage/...` URL fails `startAccessingSecurityScopedResource`
-> `Operation not permitted (os error 1)` for BOTH the native `write_backup_zip` and plugin-fs
streamed `writeFile`. The fallback's `writeFile(path, readable)` rejected unobserved, nothing
drained the TransformStream, ZipWriter waited on backpressure forever = 0% hang.
NOT our `ensure_path_allowed` (that returns Forbidden); #6478 (Readest-folder scope) unrelated.

**Fix MERGED #6486 (dbdc2f0d4, 3 CodeRabbit rounds: error the TransformStream via captured controller from EITHER side, allSettled before cleanup, shareFile direct: "Share cancelled" -> false, other errors throw)**:
iOS stages the zip in `Temp/shared/<name>` -> sharekit `shareFile` -> deleteFile in finally.
NOT via `appService.saveFile`: it swallows every share error and returns true. Worktree removed.

**Device recipe:** iwdp can't attach iOS 17+; build `tauri ios build -- --features devtools` from
the MAIN checkout (worktrees lack `gen/apple` -> Info.plist not found), install with
`xcrun devicectl device install app` (or ideviceinstaller over USB), launch with
`devicectl device process launch --terminate-existing` (fails while Locked). Diagnostics:
`invoke('plugin:log|log', {level:5, message})` from JS, then pull
`Library/Application Support/com.bilingify.readest/logs/Readest.log` with
`afcclient --container com.bilingify.readest` (dev-signed app). User must tap the pickers.
Worktree, branch and diag stash removed after merge.
