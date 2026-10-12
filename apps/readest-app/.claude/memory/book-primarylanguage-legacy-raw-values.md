---
name: book-primarylanguage-legacy-raw-values
description: "book.primaryLanguage is normally a bare ISO 639-1 code, but books imported 2025-04-23..2025-08-04 still store the raw dc:language (en-US, EN, eng)"
metadata:
  node_type: memory
  type: project
  originSessionId: 1397d54d-f940-4bd6-aad5-111f9219655d
  modified: 2026-10-09T16:26:43.499Z
---

`getPrimaryLanguage` (`src/utils/book.ts`) only started normalizing (bare 639-1, invalid → `en`) in 3e5e4d294 (2025-08-04). Between 4dc943d23 (2025-04-23) and then it returned the raw `dc:language`. That value persists in library.json; only manual "Refresh metadata" (`refreshBookMetadata`) rewrites it.

**Why:** PR #6672 (MERGED) — a literal `primaryLanguage !== 'en'` check missed stored `en-US`/`eng`, so CJK books tagged as English stayed English. Found by CodeRabbit after review.

**How to apply:** never compare `book.primaryLanguage` to a literal. Normalize first (`normalizedLangCode`, and treat `eng` like `en`); `isSameLang(x, 'en')` alone misses `eng`.
