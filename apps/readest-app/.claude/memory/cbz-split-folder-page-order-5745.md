---
name: cbz-split-folder-page-order-5745
description: "#5745 CBZ split-chapter folders (Chapter 0060 (2)/) rendered before base folder; fix = per-segment natural sort in comic-book.js"
metadata: 
  node_type: memory
  type: project
  originSessionId: 47c68a54-3e9b-41c3-bfd1-8c4d882f8433
  modified: 2026-08-17T15:10:07.268Z
---

**#5745** — CBZ pages from `Chapter 0060 (2)/` shown before `Chapter 0060/`. Root cause: `packages/foliate-js/comic-book.js` flattened archive image paths and sorted them as plain strings; space (0x20) sorts before slash (0x2F), so `Chapter 0060 (2)/001.jpg` < `Chapter 0060/001.jpg`.

**Key insight:** upstream foliate-js switched to `.sort(new Intl.Collator([], { numeric: true }).compare)` on whole paths — that fixes `2.jpg` vs `10.jpg` but NOT the split-folder case (verified empirically 2026-08-17). Only a per-segment compare works: split on `/`, compare segments with a numeric collator, shorter path wins at divergence (prefix folder sorts first). Bonus: also fixes unpadded numeric page names.

**Fix:** MERGED 2026-08-17 — foliate#79 (squashed as 4735c0a) + app PR #5762 (submodule pinned to fork main tip 25ae018, which also picked up OPDS #66). Regression test `src/__tests__/foliate-cbz-page-order.test.ts`. Device verify pending (Windows reporter). Same two-PR pattern as [[footnote-popup-selection-5646]]. Lessons: fork PRs are SQUASH-merged, so an app PR must re-pin to the squashed main commit before merging or the gitlink dangles; a worktree's submodule `origin` is the MAIN checkout's `.git/modules` dir, so new fork commits need `git fetch https://github.com/readest/foliate-js.git main` inside the worktree submodule; `git worktree remove` refuses worktrees with submodules — use `pnpm worktree:rm <branch>`.

**Caveat:** changing sort order shifts section indices for existing CBZ libraries with affected layouts, so stored reading positions in such books may point one part off after update — accepted as bug-fix behavior.

**Note:** `pnpm test` full suite has pre-existing order-dependent flakes unrelated to this: `native-app-service-share.test.ts`, `SearchResults.test.tsx`, `library-search-ssr.test.ts` each failed in one full run and passed standalone/in other runs.
