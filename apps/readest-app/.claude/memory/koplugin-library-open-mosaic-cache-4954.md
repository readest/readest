---
name: koplugin-library-open-mosaic-cache-4954
description: koplugin Library slow open on large libraries — group-cover mosaics recomposed every paint; fixed by availability-keyed cache + async compose
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e7dbb83-cffb-495d-9778-bf94ccb45d8b
---

Issue #4954 (PR #4974, MERGED 2026-07-07): opening the KOReader plugin Library
was slow on large libraries (~1000 books) while navigation stayed fast.

**Root cause (measured, not guessed).** Added open-path timing instrumentation
(`ui/time` + `elapsed_ms` helper) to `library/librarywidget.lua` (initial
`build_item_table`, `lightScan`, post-scan refresh, total synchronous open,
cloud-sync elapsed) and a step breakdown in `library/localscanner.lua`. On a
685-book library the synchronous open was ~300ms, dominated by a **254ms
post-scan refresh** = `library/group_covers.lua` recomposing each folder's 2x2
cover **mosaic from scratch on every paint** (up to 4 MuPDF decodes+scales per
cell), with no cache, and again on the post-sync refresh. `build_item_table`
(7ms) and `lightScan` (28ms, only 16 sidecar reads) were NOT the bottleneck —
my initial hypotheses (defer lightScan / incremental history) were refuted by
the log. Why "slow to load, fast to navigate": the root Groups view is mosaics;
drilling into a group shows single covers (cheap, BIM-cached). Soft-scales with
size (fuller groups → 4 covers/mosaic vs 1). Data-side pagination is NOT
possible (KOReader `Menu` derives page count from `#item_table`).

**Fix (mirror `cloud_covers` async pattern in `group_covers`).**
- Cache composed master bb per group, keyed by `mosaic_cache_key` = ordered
  child hashes + a per-child **cover-availability bit** (`child_cover_available`
  → `cloud_covers.cover_exists(hash)` or local file stat). Serve `copy_bb` on
  hit. The availability bit fixes the historical "partial composite served
  forever" bug that killed the prior on-disk cache: a late cover flips the key
  and recomposes once.
- **Cache the `nil` result too** (critical): a coverless group whose children
  aren't downloaded makes `compose` return nil; if not cached it re-enqueues +
  `schedule_refresh` on every refresh → infinite recompose/refresh loop (eink
  flashing). Caught this in the second emulator log (`group_nameLanguagegrid`
  missing every refresh). Cache nil under the availability key → placeholder
  served, no re-enqueue.
- Compose off first-paint: miss enqueues a single-slot background job (one
  mosaic per UI `nextTick`, `_pump_scheduled` coalesces), returns nil so the
  cell paints its FakeCover placeholder; completions coalesce into one refresh.
- `clear_cache()` on Library close (via `libraryitem.set_visible_hashes(nil)`)
  frees masters (~0.7MB each).

Result: synchronous open 300ms→151ms, post-scan refresh 254ms→89ms (now just the
4 visible single cloud-book cover decodes + placeholders, mosaics deferred).

**Left out (follow-ups noted in PR):** single cloud-book covers
(`cloud_covers.load_cover_bb`) still re-decode from disk each refresh (~89ms/4)
— same copy-on-serve cache could apply; deferred cloud sync uses synchronous
HTTP that briefly freezes UI after the menu appears (elapsed 1.6-6.8s, network
variance). Instrumentation kept intentionally (Library open is infrequent).
See [[koplugin-stats-duplicate-book-rows-4861]], [[koplugin-library-stale-synced-cursor-4934]].
