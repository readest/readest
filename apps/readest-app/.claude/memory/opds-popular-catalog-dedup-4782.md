---
name: opds-popular-catalog-dedup-4782
description: "Added popular OPDS catalog still showed in Popular section (looked like a duplicate); filter it out, not just hide its Add button"
metadata: 
  node_type: memory
  type: project
  originSessionId: fd07b2a4-290b-4f10-a01d-190281571221
---

Issue #4782: adding a generic "Popular Catalog" (e.g. Project Gutenberg) to My
Catalogs left it ALSO rendering in the Popular Catalogs section → looked like a
duplicate.

Root cause in `src/app/opds/components/CatalogManager.tsx`: on add, only the
**Add button** was hidden (`{!isAdded && ...}`) — the whole card kept rendering
with its Browse button, so the entry visibly appeared in both sections.

Fix: filter added/disabled entries out of the Popular list entirely. New pure
helper `getUnaddedPopularCatalogs(popular, added)` in
`src/app/opds/utils/opdsUtils.ts` dedups by **normalized URL** (trim +
lowercase), mirroring the store's `findByUrl`. Component computes
`popularCatalogs = isOnlineCatalogsAccessible ? getUnaddedPopularCatalogs(POPULAR_CATALOGS, catalogs) : []`;
the section already auto-hides on `popularCatalogs.length === 0`, so once all
popular entries are added the whole section disappears. Tested in
`src/__tests__/app/opds/opds-utils.test.ts`.

Related: [[opds-self-link-metadata-4749]], [[opds-groups-carousel-4750]].
