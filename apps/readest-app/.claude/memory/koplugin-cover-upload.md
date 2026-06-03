---
name: koplugin-cover-upload
description: "koplugin cover system — where local/cloud covers come from, and the"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 95cdff70-ce2c-4077-82a8-922f9578a22f
---

readest.koplugin cover handling (in `apps/readest.koplugin/library/`):

- **Local book covers** come from coverbrowser.koplugin's `BookInfoManager` (a hard dependency). `coverprovider.get_local_cover(file_path)` returns `BIM:getBookInfo(file_path, true).cover_bb` (a downscaled thumbnail bb) and kicks off background extraction on a miss.
- **Native-resolution cover** for a file (no open doc needed): `require("apps/filemanager/filemanagerbookinfo"):getCoverImage(nil, file_path)` — opens+closes the doc itself, honors KOReader custom covers, returns a blitbuffer. Same `(nil, file)` call form `calibre.koplugin` uses. Write it to PNG with `bb:writeToFile(path, "png")` (pcall-wrapped internally) then `bb:free()`.
- **Cloud covers** are downloaded to `DataStorage:getSettingsDir()/readest_covers/<hash>.png` (`cloud_covers.covers_dir()`); cloud storage key is `<user_id>/Readest/Books/<hash>/cover.png` (`build_cover_key`), which matches readest's `getCoverFilename` (`<hash>/cover.png`).

**Issue #4374 (fixed):** `syncbooks.uploadBook` only shipped a `cover.png` if one was *already cached* under `readest_covers/<hash>.png` from a prior cloud download — so books that originated locally in KOReader uploaded with no cover and showed blank in readest. Fix = `syncbooks.extractLocalCover(file_path, dst_png)` (extracts via `getCoverImage` → writeToFile), called from `uploadBook` when `has_cover` is false. Only file-upload path is `librarywidget.lua` "Upload to Cloud" → `uploadBook` (FileManager `addToReadest` only stages a local row).

Tests: network/live parts of `syncbooks.lua` aren't unit-tested (manual matrix in `docs/library-design.md`); `extractLocalCover` IS tested by injecting a fake `apps/filemanager/filemanagerbookinfo` via `package.loaded` in `spec/library/syncbooks_spec.lua`. A real KOReader checkout lives at `/Users/chrox/dev/koreader` for verifying KOReader APIs. See [[koplugin-i18n]].
