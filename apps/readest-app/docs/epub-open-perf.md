# EPUB Open Performance: Lazy IDB Blob Loading

## Change Summary

Replaced eager `ArrayBuffer` reads from IndexedDB with lazy `Blob`-backed reads via a new `IDBFile` class. Previously `openFile()` pulled the entire EPUB into the V8 heap before handing it to `DocumentLoader`. With Blob storage, the browser keeps bytes on disk and only materialises the slices that zip.js requests (ZIP tail → central directory → current chapter).

## Reverend_Insanity.epub — Before vs After

| Checkpoint              | Before (ArrayBuffer IDB) | After (Blob IDB / IDBFile) | Change                |
| ----------------------- | ------------------------ | -------------------------- | --------------------- |
| `initViewState-start`   | 0.0 ms                   | 0.0 ms                     | —                     |
| `loadBookContent-done`  | +3,503.7 ms              | +0.9 ms                    | **−3,503 ms**         |
| ↳ `exists-done`         | —                        | +0.6 ms                    |                       |
| ↳ `openFile-local-done` | —                        | +0.3 ms                    |                       |
| `documentLoader-done`   | +62.4 ms                 | +108.6 ms                  | +46 ms                |
| ↳ `zip-entries-read`    | —                        | +26.4 ms                   |                       |
| ↳ `module-imported`     | —                        | +0.8 ms                    |                       |
| ↳ `container-loaded`    | —                        | +6.3 ms                    |                       |
| ↳ `opf-loaded`          | —                        | +13.2 ms                   |                       |
| ↳ `spine-mapped`        | —                        | +20.8 ms                   |                       |
| ↳ `toc-loaded`          | —                        | +30.6 ms                   |                       |
| ↳ `subitems-done`       | —                        | +2.8 ms                    |                       |
| `view-open-done`        | —                        | +4.5 ms                    |                       |
| `stabilized`            | —                        | +20.0 ms                   |                       |
| `view-init-done`        | —                        | +0.7 ms                    |                       |
| **TOTAL**               | **~3,566 ms**            | **134.7 ms**               | **−96% (26× faster)** |

> **Before** timing captured from browser profiler prior to the IDB Blob migration (raw ArrayBuffer IDB reads).
> **After** timing captured with `IDBFile` lazy Blob path using the same `WebAppService` code path as the app.

## Key Files Changed

| File                            | Change                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/utils/file.ts`             | Added `IDBFile` class — lazy Blob-backed `ClosableFile`                                                       |
| `src/services/webAppService.ts` | `writeFile()` stores Blob; `openFile()` returns `IDBFile`; startup migration for existing ArrayBuffer records |
| `packages/foliate-js/epub.js`   | Added `performance.mark()` sub-marks in `EPUB.init()`                                                         |
| `src/libs/document.ts`          | Added `[epub-open]` sub-marks around zip + module-import steps                                                |
| `src/utils/bookProfiler.ts`     | Added `injectSubMarks()` for nested timing tree output                                                        |
| `src/store/readerStore.ts`      | Added `[load-content]` and `[epub-open]` sub-mark injection calls                                             |
| `src/services/bookService.ts`   | Added `[load-content]` performance marks in `loadBookContent()`                                               |

---

# EPUB Open Performance: Disk-Cached TOC

## Change Summary

At import time, the parsed TOC (`toc`, `pageList`, `landmarks`) is written to `Cache/<hash>/toc.json` as a non-blocking fire-and-forget write. On every subsequent open, `DocumentLoader` starts reading that cache file immediately — in parallel with ZIP entry scanning — and passes the result to `EPUB.init()`, which skips `parseNav`/`parseNCX` entirely when the cache is present. The cache read IO is hidden behind the 16–29 ms ZIP scan, making its net cost ~0 ms.

## Reverend_Insanity.epub — Before vs After

| Checkpoint            | Before (no TOC cache) | After (disk-cached TOC) | Change       |
| --------------------- | --------------------- | ----------------------- | ------------ |
| `zip-entries-read`    | +28.1 ms              | +15.8 ms                | —            |
| `module-imported`     | +0.5 ms               | +1.3 ms                 | —            |
| `container-loaded`    | +4.9 ms               | +3.2 ms                 | —            |
| `opf-loaded`          | +12.5 ms              | +11.6 ms                | —            |
| `spine-mapped`        | +22.1 ms              | +18.9 ms                | —            |
| `toc-loaded`          | **+30.5 ms**          | **+0.0 ms**             | **−30.5 ms** |
| `subitems-done`       | +3.3 ms               | +1.3 ms                 | —            |
| `documentLoader-done` | 111.0 ms total        | 61.5 ms total           | **−45%**     |

> **Before** timing captured without TOC cache (cold open, full `parseNav` on nav.xhtml).
> **After** timing captured on second open with warm cache; `toc-loaded` delta drops to 0 ms because the cache read completes inside the ZIP scan window.

## Key Files Changed

| File                                                        | Change                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/foliate-js/epub.js`                               | `EPUB.init({ cachedTOC })` skips `parseNav`/`parseNCX` when cache is provided |
| `src/libs/document.ts`                                      | `DocumentLoader` reads `Cache/<hash>/toc.json` in parallel with ZIP IO        |
| `src/services/bookService.ts`                               | Non-blocking TOC cache write at import time                                   |
| `src/store/readerStore.ts`                                  | Passes `{ bookHash, fs }` cache context to `DocumentLoader`                   |
| `src/__tests__/document/book-open-profiler.browser.test.ts` | Pre-caches TOC for all fixtures; passes `cacheContext` in profiled run        |

---

# EPUB Open Performance: Disk-Cached Subitems

## Change Summary

`#updateSubItems()` in `epub.js` builds per-section TOC fragment metadata by loading every chapter's HTML and running regex searches to locate heading positions. For large books (e.g. War and Peace with hundreds of chapters) this takes ~480 ms on every open.

The same cache-at-import pattern used for the TOC now applies to subitems. At import time, the computed `section.subitems` arrays are serialised to `Cache/<hash>/subitems.json` as a non-blocking write. On every subsequent open, `DocumentLoader` reads that file in parallel with the TOC cache and the ZIP scan, passing the result to `EPUB.init()`, which assigns subitems directly to sections and returns early — skipping all HTML loading and regex work.

For books already imported before this change, `DocumentLoader` lazy-writes `subitems.json` after the first open with a cache context, so the second open benefits automatically without requiring a re-import.

Added granular profiler sub-marks inside `#updateSubItems()` (`subitems-toc-grouped`, `subitems-sections-grouped`, `subitems-built`) to pinpoint which phase was slow. Also fixed `bookProfiler` table formatting: `MARK_COL` is now computed dynamically from the longest label in the session so sub-mark rows never overflow the column.

## war-peace-noimages.epub — Before vs After

| Checkpoint                  | Before (no subitems cache) | After (disk-cached subitems) | Change      |
| --------------------------- | -------------------------- | ---------------------------- | ----------- |
| `zip-entries-read`          | +5.7 ms                    | +5.7 ms                      | —           |
| `module-imported`           | +0.1 ms                    | +0.1 ms                      | —           |
| `container-loaded`          | +1.5 ms                    | +1.5 ms                      | —           |
| `opf-loaded`                | +2.9 ms                    | +2.9 ms                      | —           |
| `spine-mapped`              | +3.5 ms                    | +3.5 ms                      | —           |
| `toc-loaded`                | +0.0 ms                    | +0.0 ms                      | —           |
| `subitems-toc-grouped`      | +0.0 ms                    | +0.0 ms                      | —           |
| `subitems-sections-grouped` | +0.3 ms                    | +0.3 ms                      | —           |
| `subitems-built`            | **+466.2 ms**              | **+0.0 ms**                  | **−466 ms** |
| `subitems-done`             | +0.0 ms                    | +0.0 ms                      | —           |
| `documentLoader-done`       | ~502 ms total              | ~35 ms total                 | **−93%**    |

> **Before** timing: War and Peace epub, second open with TOC cache warm but no subitems cache.
> **After** timing: second open with both TOC and subitems caches warm; `subitems-built` drops to ~0 ms because subitems are applied directly from the JSON cache.

## Key Files Changed

| File                                                        | Change                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/foliate-js/epub.js`                               | `#updateSubItems(cachedSubitems)` short-circuits to direct assignment when cache is present; added diagnostic sub-marks |
| `src/libs/document.ts`                                      | Reads `subitems.json` in parallel; lazy-writes on cache miss; exports `buildSubitemsData`                               |
| `src/services/bookService.ts`                               | Non-blocking subitems cache write at import time via `buildSubitemsData`                                                |
| `src/utils/bookProfiler.ts`                                 | `MARK_COL` computed dynamically; fixed top-border width formula                                                         |
| `src/__tests__/document/book-open-profiler.browser.test.ts` | Pre-caches subitems for all EPUB fixtures in `beforeAll`                                                                |
