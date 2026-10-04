---
name: epub-meta-cover-href
description: "EPUB2 <meta name=\"cover\" content> holding an href (not an id) picked a random/XHTML cover; fixed in Rust + foliate-js; foliate image-guard follow-up NOT done"
metadata:
  node_type: memory
  type: project
  originSessionId: dafc4ba4-572a-4661-803a-bbbe662fe443
  modified: 2026-10-04T18:10:48.850Z
---

FB2-converted EPUBs (e.g. The Kite Runner) put the image href in `<meta name="cover" content>`. Rust `resolve_cover_path` missed and took the "first" image from a HashMap (random, a 267x204 back-matter picture); foliate-js took the guide's `cover.xhtml` and returned XHTML bytes. Fixed by href fallback + ordered `Vec` manifest: foliate-js#123 + readest#6635 MERGED (12bd7f34c) 2026-10-05, UNRELEASED. Re-importing does NOT fix existing books: `bookService.ts` import only extracts a cover when `cover.png` is absent, so the stale cover survives (seen 2026-10-05 on chrox's Mac: re-imported EPUB byte-identical, cover.png still pic_3.jpg). Deleting the local cache, then importing, gave the correct cover. Auto re-extract on re-import (when `coverUpdatedAt` is unset) was proposed but NOT built.

**Open follow-up:** #6635 restricts the Rust href match to `image/*` (CodeRabbit catch: `content="cover.xhtml"` returned the XHTML page). foliate-js#123 has NO such guard, so web still prefers an href-named XHTML page over a real cover image. Fix = same media-type check in `epub.js` Resources cover chain + submodule bump.

**Why:** both parsers must pick the same cover. **How to apply:** any cover-resolution change goes into BOTH `src-tauri/src/epub_parser.rs` and `packages/foliate-js/epub.js`; the extensions/windows-thumbnail extractor is a third, independent implementation.
