---
name: pdf-metahash-filename-salt-5411
description: "#5411 distinct PDFs collapsed by metaHash dedupe; PDF metaHash now salted with original filename, preserved on re-parse"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6888d094-29f2-4e4e-aa4d-b30f8ccef872
  modified: 2026-08-05T06:46:05.780Z
---

Issue #5411: importing 8 PowerPoint-exported PDFs showed only 4 — PDF exports share
generic embedded metadata (title "PowerPoint Presentation" + same author, no
identifiers), so `importBook`'s metaHash dedupe (`md5(title|authors|identifiers)` per
format) collapsed distinct files into one entry. The metaHashMatch merge even replaces
the survivor's `hash` and deletes the old book dir, so prior imports vanish.

Fix (MERGED #5412, 2026-07-31): `getMetadataHashInfo(metadata, filename?)` appends `|filename` to
hashSource when given. `importBook` passes `getBaseFilename(filename)` for PDFs only —
EPUB dedupe stays filename-independent on purpose (identifiers are reliable there).

**Key constraint:** the original filename is LOST after import (file stored as
`{hash}/{sourceTitle}.pdf`), so the salt can never be recomputed. Both re-parse sites —
`readerStore.initViewState` and `refreshBookMetadata` — must PRESERVE `book.metaHash`
for PDFs (`if (format !== 'PDF' || !book.metaHash) recompute`). Any new code that
recomputes metaHash from a parsed bookDoc must do the same or PDF hashes flip-flop.

Empty-title PDFs were never affected: title falls back to base filename at import, so
the filename was already in the hash. SyncInfoDialog is safe (prefers storedMetaHash).
Rust never computes metaHash. The koplugin DOES compute it (`readest_syncconfig.lua`
getMetadataHashInfo, cached as `meta_hash_v1` in the sidecar) — kept consistent by
[[koplugin-metahash-parity]] (2026-08-05): salt ported, library-store row preferred,
upload paths stamp meta_hash.

Related: [[auto-import-duplicate-files-reimport]] [[webnovel-url-import-5294]]
[[koplugin-metahash-parity]]
