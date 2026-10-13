---
name: custom-data-location-transfer-forbidden-6383
description: 0.12.10 regression — uploads/downloads fail with a custom data location because ensure_path_allowed dropped the "Readest" fallback (#6343); fix MERGED #6478 (b1bf6ddf2)
metadata:
  type: project
---

#6383: with a custom data location (Android `/storage/emulated/0/Books/Readest`, portable Windows, macOS iCloud Drive), every book upload/download failed ("Unknown" error) in 0.12.10. Config sync still worked because it doesn't use the native transfer commands.

Root cause: #6343 (d2eb427b5) rewrote `ensure_path_allowed` in `src-tauri/src/transfer_file.rs` to allow only the fs scope + app dirs. Custom roots are in neither: the Android native-bridge picker and the portable exec dir never enter `fs_scope()`, and the `**/Readest/**/*` capability is command-scoped only. The same check gates dir_scanner, cover_thumbnail, pdf_parser, backup_zip.

Fix MERGED #6478 (b1bf6ddf2) 2026-09-30, UNRELEASED: accept a resolved path with a whole `Readest` path component (`is_within_data_dir`); `resolve_request` refuses `..` first and resolves symlinks. Follow-up from CodeRabbit in the same PR: `write_entries` in backup_zip.rs now opens each entry by its canonical path and skips links that leave the source (a missing source dir still skips files, never aborts). Not verified in the running app with a custom data location.

**Why:** tightening the Rust path check past what the fs capability grants breaks custom roots silently.
**How to apply:** any future change to `ensure_path_allowed` must keep `<custom root>/Readest/...` allowed; test with a custom data location.
