---
name: azw3-loadraw-concurrency-5918
description: "#5918 AZW3 garbled text + dead TOC = KF8 loadRaw races itself when section loads overlap on RemoteFile-backed reads"
metadata: 
  node_type: memory
  type: project
  originSessionId: b3978eb9-076c-41c0-ab44-e6e42a129a19
  modified: 2026-08-28T11:11:54.858Z
---

**#5918** (reported 2026-08-28, Windows + Android, 0.12.1): some AZW3 books show `�`,
lose runs of text, and their TOC entries navigate nowhere. Calibre/WeChat Read are fine.

**ROOT CAUSE** (proven, not guessed): `KF8.loadRaw()` in `packages/foliate-js/mobi.js`.
KF8 has no random access to its text — `loadRaw(start, end)` walks PalmDOC records into a
growing `#rawHead` / `#rawTail` accumulator and slices the window out. The walk `await`s a
record read *inside* the loop while mutating `#rawHead` / `#lastLoadedHead`, so two
overlapping `loadRaw` calls append records in **completion** order, not index order. Every
byte offset after the first out-of-order append is then wrong → sections assemble bytes
from elsewhere in the book (UTF-8 split at the seams = `�`), markup truncates, and
`resolveHref`'s fragment-selector extraction reads the wrong bytes = dead TOC links.

**Why only Windows + Android:** web opens the book as an in-memory `File`, whose
`slice().arrayBuffer()` settles in issue order, so the race is invisible. Desktop/Android go
through `RemoteFile` (`src/utils/file.ts`, see `nativeAppService.openFile`) whose reads are
real ranged fetches that finish out of order. Overlap comes from the paginator: `#preloadNext`
/ `#loadAdjacentSection` in `paginator.js` are fired unawaited (lines ~1529, ~3321) while
`goTo` does its own `section.load()`.

**FIX — SHIPPED 2026-08-28.** readest **#5920 MERGED** (merge `7e8abebcd`, issue CLOSED) + foliate
**readest/foliate-js#86 MERGED** (squashed to `ca3f118`; submodule re-pinned off the PR branch to that
commit in 74aea1bf4 — foliate squash-merges, so the branch-commit pin would have dangled). All branches
and worktrees cleared, `dev` fast-forwarded. **Reporter verify still PENDING** — never run on real
Windows/Android, only through the test harness. Serialize `loadRaw` on a promise chain
(`#rawQueue`) with the old body moved to `#loadRawLocked`. Regression test
`src/__tests__/libs/mobi-kf8-concurrent-reads.test.ts` + fixture
`src/__tests__/fixtures/data/repro-5918.azw3` (85 KB, 12-chapter Chinese AZW3 built with
`ebook-convert`); it drives a `File` subclass whose slices settle after a jittered delay.
Without the fix 6/12 sections mismatch; the reporter's real 11 MB book had 58/170.

**SECOND, SEPARATE BUG found while bisecting** — `RemoteFile.fetchRange` cache-hit predicate
used `end <= chunkStart + bufferSize` with an **inclusive** `end`, so a range ending exactly
one byte past a cached chunk took the cache branch and `ArrayBuffer.slice` *clamped* instead
of throwing: a silent one-byte-short read, which truncates a PalmDOC record and corrupts
every offset after it. Fixed to `end <`. `NativeFile.readData` uses an exclusive end and is
correct as written. Test in `src/__tests__/utils/file.test.ts`.

**Recipe notes**
- The reporter's SharePoint (`*.sharepoint.cn`) link downloads with two curl calls: follow the
  `:u:/g/...` redirect with a cookie jar to pick up `FedAuth`, then GET
  `/_layouts/15/download.aspx?SourceUrl=<path from the redirect's Location>`. `&download=1` alone 403s.
- foliate-js `mobi.js` can be driven headless under jsdom: shim `DOMParser`, `XMLSerializer`,
  `URL.createObjectURL`, and **`CSS.escape`** (jsdom has no `CSS`), then `new MOBI({unzlib}).open(file)`.
- `pnpm test` on `dev` has one pre-existing failure, `Notebook.test.tsx` (untracked WIP from
  another task) — not a regression from this work.
- This repo is shared with concurrent agent sessions: a commit landed on the WRONG branch because
  another task checked out `fix/group-metadata-lww-5911-5912` (branched off 377a26164) between turns.
  ALWAYS `git branch --show-current` right before committing here; recover with
  `git reset --soft HEAD~1` + `git restore --staged <paths>`, then commit on the right branch.

Related: [[bug-patterns]] · [[paginator-scroll-fixes]]
