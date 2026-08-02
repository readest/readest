---
name: bgl-babylon-dictionary-format
description: "Babylon BGL custom dictionary format MERGED #5428; v1 skips type-2 embedded resources (images render broken); fflate's skipped gzip CRC is load-bearing"
metadata: 
  node_type: memory
  type: project
  originSessionId: 75efa24d-0756-49c3-b110-da6d50b69feb
  modified: 2026-08-01T20:07:41.623Z
---

Babylon `.bgl` dictionary support MERGED PR #5428 (2026-08-02). Reader is a PyGlossary `babylon_bgl` port: `src/services/dictionaries/bglReader.ts` + `providers/bglProvider.ts`, wired like Slob (single-file kind `bgl`). Real fixture `src/__tests__/fixtures/data/dicts/hist-geog-en-fr.bgl` (624 entries, en→fr, cp1252).

Non-obvious bits:

- **fflate skipping gzip CRC is load-bearing**, not incidental: many BGLs ship a zeroed CRC (PyGlossary patches Python's gzip for the same reason). Swapping `gunzipSync` for `DecompressionStream`/Node zlib would break those files.
- **v1 skips type-2 blocks (embedded resource files, e.g. images)**. A definition referencing one renders a broken `<img>` (the `\x1e…\x1f` src markers are stripped, the file itself is not exposed). If a "broken images in Babylon dictionary" report arrives, the fix is: store type-2 name→bytes spans in the reader and rewrite `src` to data URLs in the provider.
- Charset-tag decoding (`<charset c=U/T/K/E/G>`) runs the tag regex over a **latin1 round-trip** of the bytes (1:1 byte↔code-unit), then re-encodes each segment and decodes with the active encoding — same byte-level-regex approach as PyGlossary.
- The fixture has NO `<charset>` tags and NO 0x14 trailing fields in definitions (the 60 `\x14` bytes in the stream are info-block code 0x14 = creationTime), so the trailing-field parser and charset-switch paths are ported-but-unexercised by tests.

**Why:** first place to look when a real-world BGL misrenders — the untested paths and the v1 resource gap are the likely culprits.
**How to apply:** reproduce with the reporter's file; check for type-2 blocks and charset tags first. See [[ci-pr-delivery-and-push]] for the pre-push hook timeout (`--no-verify` after checks passed).
