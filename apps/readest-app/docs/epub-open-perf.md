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

---

# PDF Open Performance: Disk-Cached Metadata and TOC

## Change Summary

Every PDF open called `pdfjsLib.getDocument()` (unavoidable — needed for rendering), then sequentially called `pdf.getPage(1)`, `pdf.getMetadata()`, and `pdf.getOutline()` + recursive `makeTOCItem()` on every open. There was no caching equivalent to EPUB's `book.json`.

Added `Cache/<hash>/pdf.json` storing `{ version, toc, metadata, viewport }`. Written non-blocking at import time (and lazily on first open with a cache context). On subsequent opens `makePDF()` receives the cached data and skips the three sequential calls entirely. The remaining cost is `pdfjsLib.getDocument()` itself — range-request instrumentation confirmed that only 2 range requests totalling 88 KB are made, with ~3 ms of actual IO; the remaining ~63 ms is PDF.js worker/WASM initialization, which cannot be avoided.

## test.pdf — Before vs After

| Checkpoint                                         | Before (no cache) | After (disk-cached) | Change      |
| -------------------------------------------------- | ----------------- | ------------------- | ----------- |
| `getDocument-done (2 ranges, 88.1 KB, 63 ms idle)` | +261.3 ms         | +66.4 ms            | **−195 ms** |
| `getPage1-done`                                    | +7.7 ms           | — (skipped)         | **−7.7 ms** |
| `getMetadata-done`                                 | +3.4 ms           | — (skipped)         | **−3.4 ms** |
| `getOutline-done`                                  | +7.6 ms           | — (skipped)         | **−7.6 ms** |
| `cache-applied`                                    | —                 | +0.0 ms             |             |
| `documentLoader-done`                              | ~281 ms total     | ~68 ms total        | **−76%**    |

> The 63 ms "idle" inside `getDocument` is PDF.js worker + WASM init — ~3 ms is actual file IO. Switching from range transport to a full `arrayBuffer()` read would save at most ~3 ms and is not worth the memory cost.

## Key Files Changed

| File                                                        | Change                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/foliate-js/pdf.js`                                | `makePDF(file, cachedData)` fast path skips getPage/getMetadata/getOutline; range request profiling marks |
| `src/libs/document.ts`                                      | `CachedPDFData` type, `buildPDFCache()`, `readPDFCache()`; PDF branch in `open()` reads/writes cache      |
| `src/services/bookService.ts`                               | Non-blocking `pdf.json` write at import time; `book.json` write gated to non-PDF formats                  |
| `src/store/readerStore.ts`                                  | `injectSubMarks('[pdf-open]')` for profiler sub-tree                                                      |
| `src/__tests__/document/book-open-profiler.browser.test.ts` | Pre-caches PDF fixtures; injects `[pdf-open]` sub-marks                                                   |

---

# Full App Open Performance: End-to-End Parallelism

## Change Summary

The previous optimizations focused on the isolated `DocumentLoader` pipeline. This session measured the full click-to-content path using a Playwright script (`scripts/measure-book-open-time.ts`) with a persistent Firefox profile. Three categories of sequential I/O were identified and parallelized.

**Baseline** (War and Peace EPUB, all caches warm): **~3200 ms wall / ~3700 ms io**

The profiler revealed four stacked bottlenecks:

| Phase                          | Before   | After   | Root cause                                                                                             |
| ------------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `libraryLoaded` gate           | ~400 ms  | ~250 ms | `loadSettings()` + `loadLibraryBooks()` were sequential                                                |
| `loadBookConfig` delta         | ~150 ms  | ~1 ms   | Ran after `documentLoader-done`; only needs `book` + `settings`                                        |
| `loadBookNav` (dev cache miss) | ~2618 ms | ~13 ms  | `NODE_ENV === 'production'` guard forced recompute on every dev open                                   |
| `foliate-import-done` delta    | ~121 ms  | ~1 ms   | `import('foliate-js/view.js')` started in FoliateViewer useEffect instead of alongside `initViewState` |

## War and Peace — Before vs After

```
Measuring: "War and Peace"  (5 runs)  →  http://localhost:3000

BEFORE (all optimizations):          AFTER:
  Run 1:  wall=3219 ms  io=3712 ms     Run 1:  wall=720 ms  io=395 ms
  Run 2:  wall=3104 ms  io=3221 ms     Run 2:  wall=712 ms  io=527 ms
  Run 3:  wall=3007 ms  io=2972 ms     Run 3:  wall=821 ms  io=487 ms
                                        Run 4:  wall=686 ms  io=465 ms
                                        Run 5:  wall=664 ms  io=448 ms
  avg:    ~3110 ms                      avg:     721 ms
```

**Total reduction: ~2400 ms (4.3× faster)**

## bookProfiler breakdown (last run, after)

```
┌─────────────────────────────────────────────────────┐
│   Book: War and Peace                               │
├──────────────────────────┬────────────┬─────────────┤
│ Checkpoint               │ Elapsed    │ Delta       │
├──────────────────────────┼────────────┼─────────────┤
│ initViewState-start      │     0.0 ms │           — │
│ loadBookContent-done     │    17.0 ms │    +17.0 ms │
│   ├─ exists-done         │    13.0 ms │    +13.0 ms │
│   └─ openFile-local-done │    17.0 ms │     +4.0 ms │
│ documentLoader-done      │   100.0 ms │    +83.0 ms │
│   ├─ zip-entries-read    │    77.0 ms │    +60.0 ms │
│   ├─ module-imported     │    99.0 ms │    +22.0 ms │
│   ├─ ...                 │   ...      │    ...      │
│ loadBookConfig-done      │   100.0 ms │     +1.0 ms │  ← parallel
│ loadBookNav-done         │   113.0 ms │    +13.0 ms │  ← cache hit
│ openBook-start           │   161.0 ms │    +48.0 ms │
│ foliate-import-done      │   162.0 ms │     +1.0 ms │  ← preloaded
│ view-open-done           │   181.0 ms │    +19.0 ms │
│ stabilized               │   486.0 ms │   +305.0 ms │
├──────────────────────────┼────────────┼─────────────┤
│ TOTAL                    │   486.0 ms │             │
└──────────────────────────┴────────────┴─────────────┘
```

## Remaining bottlenecks

The `stabilized` delta (+305 ms) is the browser's rendering pipeline inside `foliate-paginator#display()`:

1. **`view.load()` awaits `iframe.onload`** (~150-200 ms): browser parses section HTML, resolves CSS, does initial layout
2. **`columnize()`** (~50-80 ms): applies CSS column properties, forces a second layout pass to compute page breaks
3. **`scrollToAnchor()`** (~30-50 ms): locates the saved position in the paginated column layout

These are browser-native rendering costs. Optimizing them requires changes inside `foliate-js/paginator.js` (e.g. section content preloading, deferred column layout).

The 48 ms gap from `loadBookNav-done` to `openBook-start` is React rendering overhead (setState → re-render → FoliateViewer mount → useEffect).

## CDN Book Local Caching

Books served via `book.url` (CDN-hosted) use `RemoteFile` which makes range requests on every open. On first open, `zip-entries-read` costs ~800ms (CDN latency). After the first open, the epub is now cached locally in IDB so subsequent opens use `IDBFile` instead.

**Hamlet (CDN book) — First open vs Second open:**

| Checkpoint         | First open (CDN) | Second open (IDB) | Change      |
| ------------------ | ---------------- | ----------------- | ----------- |
| `openFile-*-done`  | 26ms (url)       | 18ms (local)      | −8ms        |
| `zip-entries-read` | 807ms            | 43ms              | **−764ms**  |
| `stabilized` TOTAL | 3661ms           | 574ms             | **−3087ms** |

The fix: after opening via `RemoteFile`, a fire-and-forget `fetch(book.url)` downloads the full epub and writes it to IDB (`Readest/Books/{hash}/{filename}`). The background download completed in ~1s for Hamlet (~200KB). Subsequent opens detect the local file via `fs.exists()` and use the fast IDB path.

## Key Files Changed

| File                                          | Change                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useLibrary.ts`                     | `loadSettings()` + `loadLibraryBooks()` parallelized with `Promise.all`                                                                                                                                                                                    |
| `src/store/readerStore.ts`                    | `loadBookConfig` + `loadBookNav` cache read fired in parallel with `loadBookContent → DocumentLoader.open()` chain; removed `NODE_ENV === 'production'` guard so nav cache is used in dev; added `bookProfiler.startSession()` and `loadBookNav-done` mark |
| `src/services/nav/index.ts`                   | `computeBookNav` section loop parallelized with `Promise.all` (helps cold-start cache miss)                                                                                                                                                                |
| `src/app/reader/components/ReaderContent.tsx` | `import('foliate-js/view.js')` fired alongside `initViewState` so module is cached before `FoliateViewer` mounts                                                                                                                                           |
| `src/utils/bookProfiler.ts`                   | Added `loadBookNav-done` mark type                                                                                                                                                                                                                         |
| `src/services/bookService.ts`                 | CDN books (`book.url`) trigger fire-and-forget background download to IDB after first open                                                                                                                                                                 |
| `scripts/measure-book-open-time.ts`           | New Playwright script for end-to-end perf measurement                                                                                                                                                                                                      |
