---
name: status-grouping-i18n-5935
description: "MERGED #5935 group library by reading status; status grouping must PARTITION, and BooksGroup.localized gates which group names go through _()"
metadata:
  node_type: memory
  type: project
  originSessionId: aab36894-e607-43f6-a325-2b3560aea326
  modified: 2026-08-30T09:50:05.388Z
---

External PR #5935 (`rigen1048`, branch `StatusGrouping`) added `LibraryGroupByType.Status`.
Reviewed + fixed 2026-08-30, MERGED as squash `82658d8ed`. The contributor's CI was fully green;
every bug below was invisible to tests.

**Pushing to a contributor's fork:** `worktree:new` REBASES, so its branch head is NOT the PR head
and pushing it force-overwrites their history. Correct move: re-fetch `refs/pull/<n>/head`,
`git checkout -b <tmp> <that sha>`, `git apply --3way` the saved patch, commit, then
`git push git@github.com:<owner>/<fork>.git <tmp>:<their-branch>` (fast-forward, no --force).
Needs `maintainerCanModify: true` from `gh pr view`. See [[worktree-new-rebases-pr-force-push]].

**Bug 1: labels bypassed i18n**
- `libraryUtils.ts` built labels inline: `status === 'abandoned' ? 'On Hold' : capitalize(status)`.
  Both render sites (`GroupItem.tsx` x2, `GroupHeader` via `page.tsx` `currentVirtualGroup`) print
  `displayName` raw, so all 34 locales showed English tiles next to a translated `Status:` prefix.
- `'On Hold'` (capital H) is a *different* key from the shipped `'On hold'`, which every locale
  already translates. `Unread` / `Finished` were already shipped too; only `Reading` was new.
- `'reading'` (4th `ReadingStatus`, `types/book.ts`) was unhandled. Reachable via `utils/transform.ts`
  (`reading_status as ReadingStatus`, unvalidated) and `sync/file/merge.ts`.

Fix: `READING_STATUS_LABELS: Record<ReadingStatus, string>` built with `stubTranslation as _`. Total
record on purpose, so a 5th status cannot be added without a label. Plus `BooksGroup.localized?:
boolean`, set ONLY when `createValueGroups` receives a `getDisplayKey`. That flag is the load-bearing
part: render sites do `localized ? _(name) : name`, so a tag literally named "Unread" still renders
verbatim. A blanket `_(displayName)` would silently translate user-authored tag/author/series names.
See [[i18n-label-rename-workflow]].

**Bug 2: status grouping did not PARTITION**
`readingStatus` is an optional ANNOTATION, not a lifecycle field. Nothing stamps it at import, and
`readerStore` CLEARS 'unread' -> undefined on first open. Keying the grouping off it alone therefore
partitioned terribly. MEASURED on the real 750-book library: 414 never-opened books (55%) fell out of
the shelf entirely, and "Unread" held exactly 1 book (the only one manually re-marked). Final rule:

    isCurrentlyReadingBook(book) ? ['reading'] : [book.readingStatus ?? 'unread']

Derive BOTH ends (reading from the predicate the recently-read shelf and home-screen widget already
share; unread as the resting state) and trust the annotation for the middle. Explicit status still
wins because the predicate already excludes finished/abandoned/unread. Result: Reading 289 /
Unread 415 / Finished 45 / On hold 1, zero standalone. Verified in Chrome on the live library.

Folding the loose pile in also CLOSED a group-ordering finding I had raised separately: tiles were
scattering across positions 1/3/12 only because `getGroupSortValue` sorts groups by `group.name` into
ONE list shared with the loose books. With nothing loose left, the 4 tiles sit together. It was a
symptom, not its own bug. Nothing about status grouping remains open.

**Why:** key-as-content i18n means an unwrapped literal fails silently in every locale but English,
and CI cannot see it. A grouping that leaves the majority of rows ungrouped is likewise green.

**How to apply:** when a grouping/sort/filter surfaces an internal enum, (a) the label is a
translation key, not display text: register with `stubTranslation`, mark the carrier, translate at
render; (b) the grouping must partition, so derive a bucket for every resting state rather than
assuming an optional field is always populated. Guard it with a test asserting `standalone === []`
and that grouped books sum to the input.

**Browser-verified** via `pnpm dev-web` + `?groupBy=status` URL param (NEVER the View menu:
`handleSetGroupBy` writes `libraryGroupBy` to synced settings). Group ids are
`md5Fingerprint('status:<value>').slice(0,7)`, so `?groupBy=status&group=<id>` deep-links a bucket.
`?lng=fr` does NOT work: `settingsStore.applyUILanguage` clobbers i18next's querystring detector with
`uiLanguage ?? navigator.language`, so a live locale check needs a real settings write; the
translated render is covered by component tests instead. A pre-existing
`InvalidStateError: Transition was aborted` dev-overlay error fires on in-app group navigation for
EVERY grouping (reproduced on `groupBy=author`); unrelated to this work.

**Gotcha:** `pnpm i18n:extract` also PRUNES. On this tree it wanted to delete `Global Settings` from
all 34 locales (orphaned by #5933). Append new keys by hand rather than committing the scanner's full
output, then re-run extract to confirm it leaves your entries alone. See [[i18n-extract-prunes-keys]].

**Gotcha:** the web app's library.json is written INCREMENTALLY during cloud sync. Reading it mid-pull
shows a partial count (I saw 6, then 206, then 286, then 750) and looks alarmingly like data loss.
It is not. Let the pull finish before measuring anything.
