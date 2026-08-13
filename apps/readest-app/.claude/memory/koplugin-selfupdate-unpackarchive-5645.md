---
name: koplugin-selfupdate-unpackarchive-5645
description: "#5645 koplugin self-update crashed on KOReader v2026.07+: Device:unpackArchive was dropped upstream; fix falls back to ffi/archiver Reader"
metadata: 
  node_type: memory
  type: project
  originSessionId: 323a954d-2ddb-4a96-9040-8d1dc903386f
  modified: 2026-08-12T16:46:09.969Z
---

Issue #5645: tapping "Update" in the Readest koplugin menu crashed KOReader 2026.07.1 with `readest_selfupdate.lua:162: attempt to call method 'unpackArchive' (a nil value)`.

**Root cause:** KOReader removed `Device:unpackArchive` in koreader/koreader@751b49784 (2026-07-05, first shipped in stable v2026.07) after migrating callers to the `ffi/archiver` module. The KOReader API timeline that matters for the koplugin:

- `Device:unpackArchive` existed from ~2020 (#6959) through v2026.03.
- `ffi/archiver` (`Archiver.Reader`: `new/open/iterate/extractToPath/close`, error in `arc.err`) exists in koreader-base since v2025.08; MISSING in v2024.11 and older.
- v2026.07+ has ONLY ffi/archiver; pre-v2025.08 has ONLY Device:unpackArchive.

**Fix (PR #5656):** `SelfUpdate:unpackArchive` helper: use `Device.unpackArchive` when present (keeps native Android path on old releases), else `ffi/archiver` Reader loop. Gotchas: `Reader:close()` resets `arc.err`, so capture err BEFORE close; `Reader:next()` leaves err nil on EOF, so `ok = not arc.err` after the loop is the correct success check (same pattern the removed Device method used).

**How to apply:** The koplugin runs inside whatever KOReader version users have, including old stables. Never call a KOReader API without checking it exists across the supported version range: local KOReader repo at `/Users/chrox/dev/koreader` (with base submodule) — check with `git tag --contains $(git log --reverse -S "<api>" --format=%H | head -1)` and `git ls-tree <tag> base` + `git cat-file -e` for base modules. Koplugin uses only `Device:setIgnoreInput`, `Device.screen`, and the unpack helper as of 2026-08. Related: [[koplugin-auth-nil-response-5507]].
