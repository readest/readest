---
name: koplugin-metahash-parity
description: getMetadataHash must stay consistent between Readest (book.ts) and the koplugin (readest_syncconfig.lua); parity fix MERGED #5508
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fbed53f2-583e-42e8-bac3-1782072054e8
  modified: 2026-08-05T07:02:30.478Z
---

User directive (2026-08-05): **keep `getMetadataHash` consistent between Readest and
the KOReader plugin.** The md5(hash_source) is the fleet-wide book identity that
books/configs/notes sync under — divergence forks a book's progress across devices.

**Why:** After #5412 salted Readest's PDF metaHash with the import filename, the
koplugin still computed unsalted hashes from `doc_props`, so the same PDF got a
different fingerprint on KOReader vs Readest. Sync still worked when file bytes match
(book_hash wins), but cross-copy matching, SyncInfo "Book Fingerprint" display, and
Readest-side import dedupe all diverged.

**How to apply:** Any change to `getMetadataHashInfo` in
`apps/readest-app/src/utils/book.ts` must be mirrored in
`apps/readest.koplugin/readest_syncconfig.lua` (and vice versa). Parity is enforced by
shared hash_source fixtures: `src/__tests__/utils/metadata-hash-info.test.ts` and
`spec/syncconfig_spec.lua` assert the SAME strings (e.g.
`PowerPoint Presentation|Alice Author||lecture-01`). Update both when the format changes.

The consistency model (MERGED #5508, 2026-08-05; on-device NFC path unverified —
CI stubs utf8proc):
- Stamp once when a book enters the fleet; every other device preserves the stamp.
- koplugin `getMetaHash(ui, store)` resolution order: library-store row `meta_hash`
  (fleet-authoritative, pulled from cloud) → sidecar cache `meta_hash_v1` → compute.
  Resolved value always written back to `meta_hash_v1` (annotation flows read it raw).
- Upload paths stamp: `_uploadBookRow` via getMetaHash (doc open); `_addLocalRow`
  from sidecar doc_props when the book was read before, else leaves nil and Readest
  stamps on first open (its `if (format !== 'PDF' || !book.metaHash)` guard).
- Lua ported: PDF salt = base filename without extension; identifier scheme priority
  uuid > calibre > isbn regardless of listing order; NFC via pcall'd `ffi/utf8proc`
  (identity in specs).

Spec gotcha: busted runs all spec files in ONE Lua state — `syncannotations_spec.lua`
registers its own `package.preload["ffi/sha2"]` (djb2), racing koreader_stubs'. Never
assert literal md5 stub output; compute expected via `require("ffi/sha2").md5(...)`
so the spec shares whatever module instance production code captured.

Related: [[pdf-metahash-filename-salt-5411]]
