---
name: opds-cover-updated-cache-5492
description: "#5492 stale OPDS covers: both cover caches keyed by URL only; fix threads entry <updated> as cacheVersion; no-auth proxied covers are no-store"
metadata: 
  node_type: memory
  type: project
  originSessionId: b85b79d0-2dab-44a9-a601-0abb9d5b65f2
  modified: 2026-08-04T15:13:09.797Z
---

Issue #5492 (2026-08-04): OPDS catalog kept showing an old cover after a server replaced the
image bytes at the same URL and bumped the Atom entry's `<updated>`.

**Cache layers for OPDS covers (who can go stale):**
- `CachedImage` module-level `imageUrlCache` Map — keyed by src URL, session-lifetime.
- Disk cache `img_${md5(url)}.png` in `Cache` dir, written by `handleGenerateCachedImageUrl`
  in `src/app/opds/page.tsx` — ONLY for catalogs with auth or custom headers; persists forever
  (this is what web/OPFS users hit).
- No-auth path never goes stale via Readest: web/proxied covers use `stream=true`, and the
  OPDS proxy route sets `Cache-Control: no-store` for stream/file downloads (only feeds get
  `max-age=300`). Native no-auth direct URLs are governed by WebView HTTP cache + server headers
  (left untouched).

**Fix (MERGED PR #5495, 2026-08-04):** thread `publication.metadata.updated` (parsed by
foliate-js `getPublication`) as optional `cacheVersion` through `CachedImage` →
`onGenerateCachedImageUrl(url, cacheVersion)` → `getOPDSImageCacheFilename(url, updated)` in
`src/services/opds/cover.ts`. Entries without `<updated>` keep the historical URL-only keys so
existing cache files stay valid.

**Traps:**
- `CachedImage`'s `arePropsEqual` memo comparator must list any new prop or it swallows the
  change (same class of bug as [[cover-stale-inplace-mutation-memo]]).
- `CachedImage` is also used by UserAvatar and BookDetailEdit — new props must stay optional.
- Detail view merge (#4749/#5270) takes the detail document's `metadata` wholesale, so its
  `updated` (not the feed entry's) drives the detail-view cache key.

Related: [[opds-feed-cover-5270]], [[opds-fixes]]
