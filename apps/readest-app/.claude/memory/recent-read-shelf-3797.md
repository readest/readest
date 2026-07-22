---
name: recent-read-shelf-3797
description: "Recently-read carousel at library top (#3797 / PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: d5f79cf1-9e58-4ae4-9f8a-46a8e8ca625f
---

Opt-in "Recently read" strip in the library Virtuoso header (PR #4829, issue #3797). `selectRecentShelfBooks(books, count)` in `libraryUtils.ts` (filter `!deletedAt && progress != null`, sort by `updatedAt` desc, slice 12). Setting `libraryRecentShelfEnabled` (default false) + View-menu toggle. Rendered via the Virtuoso `Header` through `BookshelfListContext` (stable identity → no grid re-render churn); list `<Virtuoso>` needs explicit `context={listContext}`.

**Reuse, don't reimplement:** each slide renders the real `BookItem` (identical cover/title/progress/badges). The open path was extracted to `src/app/library/hooks/useOpenBook.ts` (in-place stale-record probe + `makeBookAvailable` on-demand download for cloud-only synced books + navigate) and is shared by `BookshelfItem` AND the recent shelf. Do NOT open via the select-mode `navigateToReader` path — it skips the download, so a recently-read book that synced (progress + `updatedAt`) without its blob fails to open on a second device.

**Alignment gotcha (cost several iterations):** a horizontal flex strip with `basis-1/N` does NOT match a CSS-grid column when the grid has a row gap — CSS Grid subtracts the gap from each track, flex `basis` does not (covers come out too wide at 2/3 cols where `BOOKSHELF_GRID_CLASSES` uses `gap-x-4`; matches at `sm+` where `gap-x-0`). Fix: size each slide with the grid's own formula `flexBasis: calc((100% - (var(--rs-cols) - 1) * var(--rs-gap)) / var(--rs-cols))`, with `--rs-cols` (responsive `3/4/6/8/12` ladder when auto, else `libraryColumns`) and `--rs-gap` (`1rem` base / `0px` sm+, mirroring `gap-x-4 sm:gap-x-0`) set on the row. Also `min-w-0` on each flex item, else image covers expand to intrinsic width. Verified 0.00-0.02px edge diff vs a real CSS grid at N=2/3/4/5 (standalone HTML repro + getBoundingClientRect).

Arrows: plain scroll div + `scrollBy`, shown on overflow (`scrollLeft`/`scrollWidth`, `ResizeObserver`), centered on `.bookitem-main` via measure; `start-2`/`end-2` + `rtl:rotate-180`. Swipe never opens (useLongPress moveThreshold). i18n: `i18n:extract` churns every locale (see [[i18n-extract-prunes-keys]]) — added the 2 keys manually; bo/si/ta/bn best-effort.
