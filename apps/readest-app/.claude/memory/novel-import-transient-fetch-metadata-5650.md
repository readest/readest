---
name: novel-import-transient-fetch-metadata-5650
description: "#5650 web-novel import: CDN 52x/hang retry + chapter-page metadata backfill; the real common failure was the TIMEOUT not the 52x; chapter truncation still UNFIXED"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2543ce3d-ab38-4b5a-a790-b6453dc52bd4
  modified: 2026-08-12T15:03:02.638Z
---

PR #5650 MERGED 2026-08-12 (`4f1850563`), on top of [[webnovel-url-import-5294]].
Verified on Xiaomi 13 over CDP. Two fixes in `src/services/novel/`:

**1. Transient upstream failures.** `isTransientUpstreamError()` (httpHeaders.ts) =
520-527 + 502 + 504; 503 stays with `isLikelyBotBlock`. New `fetch_transient`
code on `ConversionError`. `withTransientRetry()` wraps the fetcher with the
per-request deadline + 2 retries (1s, 2s) and is applied in BOTH `fetchNovelToc`
and `downloadNovel` (the TOC fetch previously had no retry at all).

**The trap that made the first cut a no-op:** against a struggling origin the
common failure is a **hang**, not a clean 52x. The device run failed at 15s with
"Request canceled" (the timeout path) and the new retry never fired. Fix = the
wrapper RACES the fetch against its own deadline instead of trusting the fetcher
to observe the abort, and labels the expiry `fetch_transient` ("took too long")
rather than letting it read as user cancellation. Always test the hang, not just
the error status.

**2. Chapter-page metadata backfill.** A chapter-INDEX page is often just links.
`NovelToc.weak {title, author}` marks fields that came from a page-level guess;
only `og:novel:*`/`og:title`/`twitter:title`/`books:author` count as real work
metadata. **`meta[name=author]` is demoted to a guess** — that is the crux, since
sites set it site-wide to the OPERATOR, so the wrong author was *present and
confident* and a "is it missing?" check would never fire. `parseWorkMetadata()`
reads a chapter page (og -> `h1/h2[class*=title]`, `[class*=byline]`,
`[rel=author]`, strip leading "by" -> cleaned `<title>`), guarded by the existing
`isChapterText()` so a "Chapter 7" heading can't become the book title, and
deliberately NOT consulting `meta[name=author]`. `fetchNovelToc` fetches chapter 1
only when a field is weak, fills only weak fields, best-effort.

Cost: sites that set `meta[name=author]` per-work now incur one extra chapter
fetch on the preview (value still correct).

**UNFIXED — chapters silently truncate.** A body cut short mid-stream still
arrives as HTTP 200, so nothing rejects it, extraction yields a stub, and
`failures` stays 0 (clean-looking import of a near-empty book). Observed every
chapter ending mid-word; sizes as low as 34 chars. Contributing bug:
`CHAPTER_QUALITY_FLOOR` is checked on the INTERMEDIATE extracted content, but the
`<h1>` prefix, media stripping and `sanitizeHtml` all run AFTER it. Fix = reject
an incomplete page at fetch time (no closing `</body>`/`</html>`, or short of
Content-Length) so it routes to the retry/placeholder path, AND re-check the floor
on the FINAL chapter HTML.

Metadata backfill is **device-verify PENDING** (phone dropped off USB before the
last install); parser validated against real saved page HTML.
