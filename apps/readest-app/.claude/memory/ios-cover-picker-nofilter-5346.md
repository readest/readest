---
name: ios-cover-picker-nofilter-5346
description: "iOS 'Change cover image' was a silent no-op - noFilter=isIOSApp forced the Files picker and dropped HEIC; plus $APPCACHE bare-dir missing from fs scope (simulator only). MERGED #5346"
metadata: 
  node_type: memory
  type: project
  originSessionId: c9c46722-9268-4656-ab01-f08e56c55d1c
  modified: 2026-07-26T14:26:08.624Z
---

`useFileSelector.selectFileTauri` had `noFilter = appService?.isIOSApp` **unconditionally for every selection type**. Two consequences for `covers`/`images` on iOS (PR #5346, 2026-07-26):

1. **Wrong picker.** Empty `extensions` -> tauri-plugin-dialog `parseFiltersOption([])` yields no UTTypes -> `filtersIncludeImage` false -> falls to `UIDocumentPickerViewController` (Files, `UTType.item` catch-all) instead of `PHPickerViewController`. Verified: the cover picker listed `.epub` files. Android passes real extensions so it gets the system photo picker.
2. **Silent HEIC drop.** The `noFilter` path re-applies the client whitelist (`png/jpg/jpeg/gif`); a HEIC (iPhone camera default) is filtered out -> `files.length === 0` -> `handleSelectLocalImage` returns early. No error, no toast, nothing.

Fix: `const isImageSelection = type === 'covers' || type === 'images'` and `noFilter = (isIOSApp && !isImageSelection) || (isAndroidApp && (books|dictionaries|generic))`. Deliberately did NOT flip `fonts` to filtered on iOS - woff/woff2 may lack UTTypes and would grey out.

**Separate, simulator-only defect found en route:** `getCachedImageUrl` -> `fs.writeFile(key, 'Cache')` -> `ensureDirExists` -> `createDir('', 'Cache')` = mkdir on `$APPCACHE` **itself**. `fs:scope` had only `$APPCACHE/**/*`, which needs >=1 child component, so: `forbidden path: ... allow-mkdir`. Real devices were already covered by `/private/var/mobile/Containers/Data/Application/**/*` (tauri uses `require_literal_separator: true`, so `**` spans `<UUID>/Library/Caches` and `*` matches the bundle id); simulator containers live under `~/Library/Developer/CoreSimulator/` and match nothing. Added bare `$APPCACHE`, mirroring the existing `**/Readest` + `**/Readest/**/*` pair. `$TEMP` still has the same bare-dir gap - unfixed, nothing observed hitting it.

Because `handleSelectLocalImage` has **no `.catch`**, the mkdir rejection surfaced only as an unhandled promise rejection. Any future "picker does nothing" report here should check Safari Web Inspector first.

See [[ios-sim-drive-via-dev-server-relay]] for driving the sim, [[cover-stale-inplace-mutation-memo]] for the related cover-refresh class of bug.
