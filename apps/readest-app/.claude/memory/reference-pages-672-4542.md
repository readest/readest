---
name: reference-pages-672-4542
description: "Reference Pages progress style (#672 +"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a51b785-c6db-4bab-86f1-4a9b086a0e48
---

PR #4549 (2026-06-12) merged #4542 (manual page count) into #672 (page-list/page-map): `progressStyle: 'reference'` shows physical-book pages in `ProgressBar` + `DesktopFooterBar`.

- **foliate-js already did the hard part**: `book.pageList` (EPUB3 nav page-list at `epub.js` parseNav; EPUB2 NCX `pageList` — only parsed when there's no navigable nav-doc TOC) and `view.js #pageProgress` emits `detail.pageItem` on every relocate. Readest never consumed it before. Adobe `page-map.xml` is NOT parsed, but books that ship it (Count Zero) also carry the NCX pageList, so it works anyway. Gap: EPUB3 nav-with-TOC-but-no-page-list never falls back to NCX pageList.
- **Total = highest numeric label**, not last entry (a trailing roman-numeral index page like "XII" after p553 would corrupt it — reported in #672 comments). All-roman page lists fall back to entry count. Logic in `getReferencePageInfo` (`utils/progress.ts`).
- **Per-book-only viewSettings field**: `referencePageCount` saved with `saveViewSettings(..., skipGlobal=true)` so a physical page count never leaks into `globalViewSettings` even when the user runs global settings. The merge `{...global, ...perBook}` keeps it.
- **Verification EPUBs** (issue #672 comments, in /tmp/issue672 while it lasts): Caleb's Crossing = EPUB3 nav page-list (419 pp); Count Zero = EPUB2 NCX pageList + page-map.xml (346 pp; `Text/c2.html` starts at `name="22"` — good exact-match oracle).
- **Web-import injection trick for dev-web e2e**: stage the epub in `public/`, then dispatch a synthetic `DragEvent('drop')` with a real `DataTransfer` (files added via `dt.items.add(new File(...))`) on `.library-page` — `useDragDropImport` takes it from there. The chrome-MCP `javascript_tool` has NO top-level await ("await only valid in async functions") and collects returned promises — use an async IIFE writing to `window.__result` and poll.
- **Locale-file rebase conflicts** (every feature PR appends keys to all 33 translation.json tails): don't hand-merge — `git checkout --ours -- public/locales`, re-run `pnpm i18n:extract`, re-run the translation script, `git add`, `git rebase --continue`.
