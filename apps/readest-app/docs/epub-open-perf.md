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
