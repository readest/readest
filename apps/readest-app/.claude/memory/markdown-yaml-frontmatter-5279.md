---
name: markdown-yaml-frontmatter-5279
description: "#5279 md YAML frontmatter to book metadata; http covers deliberately NOT fetched (web CORS), data URIs decoded in getCover"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6ecb55dd-6ddd-453d-b882-48ac464239c3
  modified: 2026-07-26T13:50:03.922Z
---

Issue #5279 asked for a `cover:` property in markdown YAML frontmatter plus
general frontmatter to book details. MERGED 2026-07-26 as PR #5344, squash
commit `d40bf5ba7`. Branch and worktree deleted.

New `src/utils/mdFrontmatter.ts` (`parseFrontmatter` + `frontmatterToMetadata`),
consumed by `makeMarkdownBook` in [[markdown-md-support-774]].

Two decisions worth keeping:

**http(s) covers are never fetched.** They are assigned to
`metadata.coverImageUrl`, which `BookCover.tsx` already prefers over the local
cover file. A `fetch()` inside `getCover()` would be blocked by CORS for most
image hosts on the web build and silently yield no cover. Native has
`tauriFetch` (see `imageToArrayBuffer` in bookService) but that path is
platform-specific and only reachable from the metadata-edit flow. `data:` URIs
ARE decoded to a Blob in `getCover()`, so they persist as cover.png and sync.

**Frontmatter isbn doubles as `identifier`** when no explicit `identifier` key
exists, so the same file imports to the same `metaHash` on every device. With
neither key the filename stays the identifier, which is what already-imported
md books hashed under. Do not change that fallback or existing libraries
re-import as new books.

YAML parsing is hand-rolled (no dep): scalars, block lists, flow lists,
comments, quoting. Block scalars (`|`, `>`), nested maps and anchors are
skipped by design. Keys are matched lowercase with `-`/`_` stripped, so `ISBN`,
`Cover-Image`, `series_index` all resolve.

**Why:** the cover pipeline looks like it should just fetch the URL, and the
identifier fallback looks like dead weight; both are load-bearing.

**How to apply:** if a future change makes md covers download, gate it on
platform like `imageToArrayBuffer` does, and keep `coverImageUrl` set as the
web fallback.

**Known follow-up (UNFIXED):** md books now join `metaHash` dedup, so two `.md`
files declaring the same ISBN are one book. That makes an existing race
reachable for markdown: importing two same-`metaHash` files concurrently
creates duplicate rows, then a re-import runs `mergeBooks` and soft-deletes
BOTH, leaving zero books. Reproduced in the browser 2026-07-26. Same race
exists for two EPUB copies of one book, so it is not md-specific. Flagged in
the PR body; no issue filed.
