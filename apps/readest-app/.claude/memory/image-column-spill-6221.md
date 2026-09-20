---
name: image-column-spill-6221
description: "#6221 previous page's image strip on the left of the next page (Android, paginated); root = foliate paginator published the whole page TILE (padding included) as --available-width and clamped images to it; fix = column content box; foliate-js #101 MERGED 10907a0, readest #6252 MERGED 35d7e49e8 UNRELEASED; worktree removed"
metadata:
  type: project
---

**Issue:** https://github.com/readest/readest/issues/6221 (Android 16, 0.12.8, reporter's book =
calibre-converted 邓小平时代, on the Xiaomi 13 as hash `ddef514c0f2759e8f605398a47317bfb`). Turning past
the page with the full-width map leaves an 18px strip of the map's right edge down the left margin of the
next page. Not a turn-animation leftover: the strip is static and survives further turns.

**Root cause (Xiaomi-VERIFIED over CDP 2026-09-18):** foliate `columnize()` set `--available-width`
(and the value `setImageSize` clamps a CSS `max-width` against) to `Math.trunc(width / columnCount)` =
the whole page tile, side padding INCLUDED. Page 392px, column content box 356px, so anything sized from
the variable is 392px wide, overruns the column by exactly the gap and paints on the next tile. Two
consumers hit it: readest `style.ts` rewrites hardcoded pixel widths to
`max-width: calc(var(--available-width) * 1px)` (this book's `.calibre_5 { width: 1200px }` map), and the
paginator's own `parseInt(maxWidth) > availableWidth -> availableWidth px` clamp. Regression origin:
foliate-js `2476b0d` (2026-04-11) swapped the single-column content width for the bare tile while adding
two-column support. The vertical branch had the same slip on the block axis (`height / columnCount`).

**Fix:** foliate-js PR #101 (`fix/column-available-size-6221`, 5368839): subtract the root's own side
padding on the pagination axis; `--full-*` keeps the tile because the duokan-bleed rewrite spans it with
negative `--page-margin-*`. readest PR #6252 (`fix/image-column-spill-6221`, 1d4702b95) pins the branch
commit + adds `src/__tests__/document/paginator-image-column-spill.browser.test.ts` with fixture
`repro-6221-image-column-spill.epub` (built by a throwaway Python zipfile script: 1200px PNG,
`img.pxcap { max-width: 1200px }` + `img.varcap { max-width: calc(var(--available-width) * 1px) }`).
Test asserts every `img` box stays inside its tile's content box (tile = `root.style.width`, padding from
computed style) for a single column AND a 2-column spread; failed before (`800 <= 741.89`), passes after.
foliate-js #101 MERGED as squash 10907a0 (content identical to 5368839, nothing else on main since 085ab9c); readest branch re-pinned in de6f8b93f, browser suite green on the pin; readest #6252 MERGED as 35d7e49e8 (unreleased); worktree + both branches removed, nothing left to clean.

**Verified on the Xiaomi with a `pnpm dev-android` build of the branch (2026-09-18):** `--available-width`
392 -> 356, `--full-width` stays 392, map 392px -> 356px, right edge from 17.6px past the page end to
18.3px inside it, next page clean (PR comment on #6252 has the table + screenshots described).

**Device recipe that worked:** the installed 0.12.8 was already a `dev-android` build (devtools socket
present) but `curl` needs `--noproxy '*'` and python `websocket-client` needs the proxy env vars deleted,
else "Empty reply". Readest Android keeps bfcache'd reader pages as extra hidden CDP targets; pick the
target whose `document.visibilityState` is visible (screenshots on a hidden one hang). Open a book by
navigating the visible target to `/reader?ids=<hash>`; the hash comes from the library tile's React fiber
(`memoizedProps.book.hash`). Synthetic taps/clicks through CDP did NOT open a tile. Another session on
this Mac runs `adb shell am force-stop com.bilingify.readest` every ~15 min (shared device), so never
`adb forward --remove-all`; use a private port (9333). Live proof: set `--available-width` + the inline
`max-width !important` to `renderer.size - paddings` and the strip vanishes.

**Why:** a CSS variable that names the *available* width must be the content box; the tile is `--full-*`.
**How to apply:** any new `--available-*` consumer or paginator clamp must fit inside
`tile - --page-margin-left - --page-margin-right`; assert box-in-tile in a browser test.
Related: [[image-highlight-page-spill-6128]] (same "paints on the next tile" class, overlay side),
[[duokan-footnote-image-clamp-thrash-6155]] (same `setImageSize` loop).
