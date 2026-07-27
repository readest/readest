---
name: epub-encoded-href-reserved-chars-5097
description: "EPUB chapters with reserved chars (&) in filename — #5097 blank page + #5308 TOC-nav-fails-via-stale-cache"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb189eee-4099-4fd8-82e3-181225c638d7
  modified: 2026-07-25T02:41:21.380Z
---

EPUB whose zip entry is `OEBPS/a&b.html` is referenced from OPF/NCX as `a%26b.html`.

## #5097 (blank chapter) — MERGED PR #5100, foliate #54 (commit 90764e1)
foliate `resolveURL` decoded hrefs with `decodeURI()`, which per spec preserves the
reserved set (`; / ? : @ & = + $ , #`), so the resolved href stayed `OEBPS/a%26b.html`
and never matched the raw zip entry → zip loader returns null → blank page. Fix:
`decodeURIPath` (decodeURIComponent, keeping only `%2f`/`%23` encoded) after resolution,
plus `isExternal(relativeTo)` for the scheme check. Shipped in v0.11.20. Regression test:
`src/__tests__/foliate-epub-encoded-href.test.ts` (in-memory EPUB via a custom loader).

## #5308 (can't jump to & chapter from TOC) — the follow-up, MERGED PR #5311
NOT reproducible on fresh open (web/Chrome, and maintainer's Android/iOS/macOS all fine).
Root cause = **stale nav cache**, not a live parse bug:
- Reader caches TOC in `Books/{hash}/nav.json` gated by `BOOK_NAV_VERSION` (was 3).
- A nav.json written by a **pre-#5097** build stored the TOC href still-encoded
  (`OEBPS/a%26b.html`). The #5097 fix did NOT bump BOOK_NAV_VERSION, so `readerStore`
  (`readerStore.ts` ~L248) reuses the stale v3 cache via `hydrateBookNav` instead of
  recomputing.
- The stale encoded href reaches `view.goTo` → foliate `resolveHref` does
  `getItemByHref(decodeURI(path))`, and **`decodeURI` can't decode reserved chars**, so
  `OEBPS/a%26b.html` never matches the now-decoded manifest entry `OEBPS/a&b.html`
  → returns null → `goTo` silently no-ops. (Proved live: `resolveHref('OEBPS/a%26b.html')`
  → null; `resolveHref('OEBPS/a&b.html')` → index 1.)

### Fix
Bump `BOOK_NAV_VERSION` 3→4 in `src/services/nav/index.ts` (v4 docblock line) to invalidate
stale caches → one-time recompute yields the decoded TOC. Extracted the version-gate into a
type-guard `isBookNavCacheCurrent(cachedNav): cachedNav is BookNav` (nav/index.ts), used by
readerStore, so the invalidation decision is unit-tested. Tests:
`book-nav-cache.test.ts` (v3 rejected / current accepted / null not current — verified it
fails if the bump is reverted) + `foliate-epub-encoded-href.test.ts` (encoded href → null).

### Why nobody could reproduce
Fresh imports always compute a correct decoded nav; and the cache path is gated
`&& process.env.NODE_ENV === 'production'`, so **dev mode always recomputes** — a stale
cache can only bite a real release build that opened the book pre-fix.

### Latent fragility to watch
foliate `resolveHref`'s `decodeURI` still can't decode reserved chars — any still-encoded
href reaching `goTo` silently no-ops. Optional defense-in-depth (not done): make `resolveHref`
decode via `decodeURIPath`. See [[bug-patterns]].
