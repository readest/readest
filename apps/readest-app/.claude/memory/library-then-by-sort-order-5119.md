---
name: library-then-by-sort-order-5119
description: "#5119 independent Then-by asc/desc: secondary direction lives inside createBookSorter, and Bookshelf URL-param cleanup silently overrides hand-made deep links"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7391c0bc-86de-4d9e-933c-f90b19ff49d3
  modified: 2026-08-03T16:49:36.145Z
---

Issue #5119, MERGED as #5474 (2026-08-04): the library's "Then by" secondary sort
got its own Ascending/Descending, stored as `libraryThenSortAscending` (default `true`) with URL
param `thenOrder`. Same pass dropped every `2` suffix: setting `librarySortBy2` ->
`libraryThenSortBy`, URL params `sort2`/`order2` -> `thenSort`/`thenOrder`.

The *setting* rename needed `migrateLibraryThenSort()` in `settingsService.ts` — `librarySortBy2`
had been persisted since 2026-05-29 (#4347), so a bare rename would silently reset everyone's
"Then by" to None. Migrate-then-`delete` the legacy key, otherwise a later explicit `'none'` gets
resurrected on the next load. The *URL param* rename needs no compat shim: the params are only a
per-view override that ViewMenu always writes in lockstep with the setting, so a stale
`?sort2=...` link just falls back to the (migrated) stored value. Only a link shared to a
different user loses the override.

Two things that are easy to get wrong:

1. **Direction must move inside `createBookSorter`.** `Bookshelf.tsx` used to multiply the whole
   comparator by `sortOrderMultiplier`, which flipped the tiebreaker along with the primary key —
   that IS the bug in #5119. `createBookSorter(sortBy, lang, secondary, sortAscending,
   secondaryAscending)` now applies both directions itself, so book-vs-book comparisons must
   NOT be multiplied again. Group-vs-group and group-vs-book comparisons still use the external
   `sortOrderMultiplier` (they only look at the primary key).
   `createWithinGroupSorter` takes `secondaryAscending` as its 6th arg; series index stays
   ascending always.

2. **`updateUrlParams` strips params that equal the app default, but the fallback is the user's
   stored setting.** `if (params.get('thenOrder') === 'asc') params.delete('thenOrder')` — after
   the strip, `thenSortOrder` falls back to `settings.libraryThenSortAscending`. So a hand-crafted
   deep link like `?thenOrder=asc` is silently overridden when the stored setting says desc. Same
   latent behavior already exists for `sort`/`order`. Consequence when verifying in the browser:
   driving sort state by typing URLs lies to you — use the View menu (it writes setting + param
   together), or `console.log` the resolved `{sortBy, sortOrder, thenSortBy, thenSortOrder}` from
   the `sortedBookshelfItems` memo.

Good live-verification recipe: search `q=` down to a handful of same-author/same-progress books
(ties on the primary key are what make the secondary observable), list view, then toggle
Then by → Ascending/Descending in the menu and watch the block reverse. See
[[web-e2e-local-devserver-cold-compile-flake]] for why the list paints blank until first scroll.

Related: [[i18n-label-rename-workflow]] was not needed here — the menu reuses the existing
`Ascending`/`Descending` keys.
