---
name: recent-read-shelf-3797
description: "Recently-read carousel at library top (#3797 / PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: d5f79cf1-9e58-4ae4-9f8a-46a8e8ca625f
  modified: 2026-08-04T08:10:14.783Z
---

Opt-in "Recently read" strip in the library Virtuoso header (PR #4829, issue #3797). `selectRecentShelfBooks(books, count)` in `libraryUtils.ts` (filter `!deletedAt && progress != null`, sort by `updatedAt` desc, slice 12). Setting `libraryRecentShelfEnabled` (default false) + View-menu toggle. Rendered via the Virtuoso `Header` through `BookshelfListContext` (stable identity → no grid re-render churn); list `<Virtuoso>` needs explicit `context={listContext}`.

**Reuse, don't reimplement:** each slide renders the real `BookItem` (identical cover/title/progress/badges). The open path was extracted to `src/app/library/hooks/useOpenBook.ts` (in-place stale-record probe + `makeBookAvailable` on-demand download for cloud-only synced books + navigate) and is shared by `BookshelfItem` AND the recent shelf. Do NOT open via the select-mode `navigateToReader` path — it skips the download, so a recently-read book that synced (progress + `updatedAt`) without its blob fails to open on a second device.

**Alignment gotcha (cost several iterations):** a horizontal flex strip with `basis-1/N` does NOT match a CSS-grid column when the grid has a row gap — CSS Grid subtracts the gap from each track, flex `basis` does not (covers come out too wide at 2/3 cols where `BOOKSHELF_GRID_CLASSES` uses `gap-x-4`; matches at `sm+` where `gap-x-0`). Fix: size each slide with the grid's own formula `flexBasis: calc((100% - (var(--rs-cols) - 1) * var(--rs-gap)) / var(--rs-cols))`, with `--rs-cols` (responsive `3/4/6/8/12` ladder when auto, else `libraryColumns`) and `--rs-gap` (`1rem` base / `0px` sm+, mirroring `gap-x-4 sm:gap-x-0`) set on the row. Also `min-w-0` on each flex item, else image covers expand to intrinsic width. Verified 0.00-0.02px edge diff vs a real CSS grid at N=2/3/4/5 (standalone HTML repro + getBoundingClientRect).

**Select mode + pull-to-refresh fixes MERGED in PR #5486** (2026-08-04; worktree and branch cleaned up; the dev working tree still carries the pre-merge file copies until the next pull).

**Pull-to-refresh (2026-08-04):** the shelf lives in the Virtuoso Header — a SIBLING of the List, and `usePullToRefresh` translated only the first `.transform-wrapper` (the List), so the shelf stayed pinned during the pull. Fix: hook now drags ALL `.transform-wrapper`s under the scroller in lockstep; shelf root carries the class. Any future scroller sibling that should ride the pull just adds `transform-wrapper`. Xiaomi 13-verified via CDP `Input.synthesizeScrollGesture` + rAF transform recorder (see [[android-cdp-e2e-lane]]).

**Select mode (2026-08-04):** the shelf originally unmounted in select mode (`!isSelectMode` in `showRecentShelf`) and `RecentSlide` hardcoded `isSelectMode={false}` — users could not select shelf books at all. Now wired like the grid: shelf stays mounted, tap toggles in select mode, long-press enters select mode + selects, `BookItem` gets real `isSelectMode`/`bookSelected`. Pass the store's `selectedBooks` **Set** (stable identity) into the header memo, not `getSelectedBooks()` (fresh array per call → would churn the Virtuoso Header identity every render). Tests: `recent-shelf-select-mode.test.tsx` (stub BookItem, real useLongPress via pointer events + fake timers).

Arrows: plain scroll div + `scrollBy`, shown on overflow (`scrollLeft`/`scrollWidth`, `ResizeObserver`), centered on `.bookitem-main` via measure; `start-2`/`end-2` + `rtl:rotate-180`. Swipe never opens (useLongPress moveThreshold). i18n: `i18n:extract` churns every locale (see [[i18n-extract-prunes-keys]]) — added the 2 keys manually; bo/si/ta/bn best-effort.
