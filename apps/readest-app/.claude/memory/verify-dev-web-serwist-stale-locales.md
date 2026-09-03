---
name: verify-dev-web-serwist-stale-locales
description: New i18n keys render in English on pnpm dev-web because the serwist service worker serves a stale /locales/<lng>/translation.json
metadata:
  type: feedback
---

When verifying a new UI string on `pnpm dev-web`, the label can render as the
raw English key even though the locale JSON on disk (and the dev server's
response) already has the translation. The page is not reading the dev server:
Readest registers a **serwist** service worker whose `offline-cache` holds the
old `/locales/<lng>/translation.json`. A plain `fetch()` of that path returns the
stale body while `fetch(path + '?cb=' + Date.now())` returns the current one -
that mismatch is the tell.

**Why:** i18next loads translations over HTTP (`loadPath:
'/locales/{{lng}}/{{ns}}.json'`, see `src/i18n/i18n.ts`), so the SW sits between
i18next and the file. Reloading the page does not help; the SW answers first.

**How to apply:** in the page console (or `javascript_tool`) run
`for (const c of await caches.keys()) await caches.delete(c)` and reload, then
re-read the label. Do this before concluding a translation is missing or that
`pnpm i18n:extract` pruned the key.
