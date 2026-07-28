---
name: play-all-files-access-restored-5372
description: Play build now ships MANAGE_EXTERNAL_STORAGE; next Play submission must fill the All Files Access declaration form
metadata: 
  node_type: memory
  type: project
  originSessionId: a133d0ec-4027-4228-8448-d7535c4e0feb
  modified: 2026-07-28T14:43:27.288Z
---

Decision (2026-07-28, chrox): the Google Play build keeps
`MANAGE_EXTERNAL_STORAGE` instead of stripping it, and every `distChannel ===
'playstore'` gate on shared-storage access is removed. MERGED #5378
(2026-07-28, merge commit `872e9b54d`).

**Why:** stripping the permission made the Play build strictly worse than the
APK: `canReadExternalDir` was false (no folder import), `MigrateDataWindow`
filtered out every `/sdcard` shortcut so "Change Data Location" offered only the
app-private Documents dir it was already using (migration could never start,
#5372), and #2862 (any custom folder as data location) was unfixable. Most
reader apps carry this permission; the plan is to justify it to the reviewer
rather than degrade the build.

**How to apply:**
- Play Console -> App content -> Permissions and APIs -> All files access needs
  a written justification at the next submission. The text to paste lives in
  `apps/readest-app/docs/google-play-all-files-access.md` (also asks for a short
  screen recording of the Change Data Location flow).
- `scripts/release-google-play.sh` now FAILS if the permission is missing and
  prints a reminder; it still strips `REQUEST_INSTALL_PACKAGES` (updater is off
  on Play).
- `canReadExternalDir` is now `DIST_CHANNEL !== 'appstore'` only. iOS App Store
  stays gated: no All Files Access equivalent.
- Android's `select_directory` native-bridge command (ACTION_OPEN_DOCUMENT_TREE)
  returns a real absolute path via `extractPathFromUri`, which is why an
  arbitrary-folder picker works at all. See [[android-nativefile-remotefile-io]].
- Rejection risk is real: if Play refuses the declaration, the fallback is
  proper SAF support in the Rust fs layer, not re-stripping the permission.
