---
name: opds2-json-search-4502
description: "OPDS 2.0 JSON catalog search bar greyed out; isSearchLink didn't recognize templated application/opds+json links"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9eb835a8-ce7a-4f80-ae3d-94e330935585
---

#4502 — OPDS 2.0 JSON catalogs (e.g. `type: "application/opds+json"`, `templated: true`, href `/opds/search{?query}`) showed a **greyed-out** navbar search input that rejected queries.

**Root cause:** `isSearchLink` (`src/app/opds/utils/opdsUtils.ts`) only matched `MIME.OPENSEARCH`/`MIME.ATOM`, so `hasSearch` (page.tsx) was false → `<input disabled={!hasSearch}>`. `handleSearch` also only handled those two types.

**Fix:**
- Add `MIME.OPDS2 = 'application/opds+json'` + `templated?: boolean` on `OPDSBaseLink`; `isSearchLink` now also accepts `type === OPDS2 && !!templated`.
- New `expandOPDSSearchTemplate(templateHref, queryTerm)` in opdsUtils expands the RFC 6570 template, placing the term in the primary text var (`query`/`searchTerms`/`q`, else first var). Reuses `foliate-js/uri-template.js` (`replace`, `getVariables`) — do NOT reinvent RFC 6570.
- page.tsx `handleSearch` adds an `OPDS2` branch.

**Gotcha (key):** `resolveURL` mangles `{?query}` template braces (`/opds/search%7B?query}`) — it treats `?` as the query start. ALWAYS `expandOPDSSearchTemplate` FIRST, THEN `resolveURL`. For OPENSEARCH/ATOM the order is reversed (resolve then `.replace('{searchTerms}', ...)`), which is why the new branch can't share the top-level `searchURL`.

**Foliate has `getSearch(link)`** (async, OPDS 2.0 JSON → OPDSSearch via uri-template) but readest's page.tsx never wired it; the JSON path just `JSON.parse`s the feed, preserving raw `templated`/`type`. OPDS 2.0 is JSON-only (XML `getFeed` links never carry `templated`).

Related: [[opds-firefox-strict-xml-4479]].
