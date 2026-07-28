---
name: webnovel-url-import-5294
description: "#5294 URL web-novel import: parseChapterList heuristic + downloadNovel → multi-chapter buildEpub; found sanitizeForParsing strips <meta> (latent clip bug)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4dab1c4c-7b2f-409e-87bb-42efd2e79aa8
  modified: 2026-07-28T16:34:07.352Z
---

Issue #5294 (URL-based novel import, StoryCodex-style) implemented 2026-07-28; PR
#5381 MERGED 2026-07-28 (`b18a2cee4`). Worktree/branches cleaned up, `dev`
fast-forwarded. Design doc: `.agents/plans/2026-07-28-web-novel-url-import.md`.

**Re-import behavior (traced, answered for maintainer):** unchanged novel → byte-
identical EPUB (zeroed zip timestamps) → hash dedup no-op; updated novel → metaHash
(`md5(title|authors|identifier)`) match in `bookService.ts` updates the existing entry
in place (new hash, config migrated, progress/notes merged, old dir removed,
re-upload). CFIs survive because chapters append at the end. Caveat: a different URL
string (scheme/slash/mirror) → different `stableIdentifier` → duplicate book; full
re-download every time (no incremental fetch).

**Chosen architecture:** real multi-chapter EPUB via the clip pipeline's `buildEpub`
(which already supported `chapters[]` and falls back to one navPoint per chapter when
no heading TOC is passed — no changes needed), NOT a `novel://` virtual book — the
feed-book route needs a twin of every `isFeedBook` call site. Chapters fetched with
plain `tauriFetch` + `pageNavigateHeaders()` (a `clip_url` webview per chapter can't
scale to hundreds), 4-worker pool, 1 retry, failures → placeholder pages, 2000-chapter
cap, images stripped, Tauri-gated like "From Web URL".

**Files:** `src/services/novel/chapterList.ts` (TOC heuristic: chapter-pattern text OR
majority href-template links; deepest container holding ≥80% of candidates beats
"latest chapters" sidebars; URL dedup; reverse when numbers descend; metadata from
`og:novel:*` → `books:author` (Royal Road) → `og:title`/`meta[name=author]` → cleaned
`<title>`), `src/services/novel/novelImport.ts` (`fetchNovelToc`/`downloadNovel`,
injectable fetchers), `ImportNovelDialog.tsx` (url → preview → progress phases),
ImportMenu "From Web Novel". Validated against a real Royal Road page (106 chapters
from 219 anchors, dedup + cover + author correct).

**Latent bug found, UNFIXED:** `sanitizeForParsing` (DOMPurify `WHOLE_DOCUMENT`
defaults) strips ALL `<meta>` tags — so `convertPageToEpub`'s `pickMetaContent(metaDoc,
META_FALLBACK.title/byline)` fallback in `convertToEpub.ts` operates on a meta-less
document and can never fire. Fix = parse the raw HTML for the meta doc (DOMParser on a
detached document executes nothing). This is why [[clip-signin-interactive-capture-5262]]
clips may miss bylines on SPA sites.

Exports added to `convertToEpub.ts`: `stableIdentifier`, `safeFileName`, `stripTags`.
`TocEntry.chapterIndex` is still declared-but-unread in `buildNavMap` (multi-chapter
heading TOCs would need it wired).

Out of scope (documented): paginated chapter lists, per-site TOC rules, "check for new
chapters" update flow, illustrations, web-platform support.
