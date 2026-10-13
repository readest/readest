---
name: duokan-slim-cover-6513
description: "#6513 Duokan cover~slim.jpg swapped in on tall fullscreen cover pages; foliate#109 + readest #6516 MERGED (b6d95317d) UNRELEASED"
metadata:
  node_type: memory
  type: project
  originSessionId: fe3566c6-c425-4c30-830e-0ed8d5abccd3
  modified: 2026-09-30T17:38:23.135Z
---

#6513 (2026-10-01): Duokan books ship `cover~slim.jpg` beside `cover.jpg`. Loader (epub.js loadReplaced) tags `<img>` with `data-duokan-slim-src` when a `~slim` sibling exists; paginator setImageSize swaps it in on `duokan-page-fullscreen` pages when height/width > 1.7, restores `data-duokan-src` otherwise/scrolled.
PRs: readest/foliate-js#109, readest/readest#6516 MERGED b6d95317d (foliate 1731485); worktree + branches removed. Fixture repro-6513.epub. Reporter's OneDrive book needs login, never tested; no device verify. SVG `<image>` covers not handled.

**Why:** track the unverified bits.
**How to apply:** related to [[paginator-scroll-fixes]].
