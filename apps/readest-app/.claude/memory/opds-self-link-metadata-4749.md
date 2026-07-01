---
name: opds-self-link-metadata-4749
description: OPDS 2.0 summary publications need self-link dereference for full metadata; JSON description is HTML
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e1e6ec0-38c1-45a2-aab6-52b78a5ad38a
---

Readest issue #4749 (pglaf/Gutenberg test feed `https://opds-test.pglaf.org/opds/`). Two related OPDS bugs, both fixed together.

**1. Summary publications need a `self`-link dereference.** OPDS 2.0 feeds may list a publication with only minimal metadata + a `rel:"self"` link of type `application/opds-publication+json` (no acquisition links, no description) — the server sends the full record only when the client follows that link on click. Thorium does this; Readest did not.
- New `src/app/opds/utils/opdsPublication.ts`: `getPublicationDetailHref(pub)` finds the `rel:"self"` link whose type is `application/opds-publication+json` or Atom `application/atom+xml;type=entry`; `parsePublicationDocument(text, docURL)` parses JSON or Atom-entry XML (reuses foliate `getPublication`) and **absolutizes** links/images hrefs against `docURL` so downloads/cover resolve regardless of the feed's `baseURL`.
- `page.tsx`: renamed derived `publication` → `basePublication`; an effect fetches the detail doc (via `fetchWithAuth` + proxy refs) when `selectedPublication` is set AND a detail link exists (skip directly-loaded entry docs — already full); merges as `{ metadata: resolved.metadata, links/images: resolved.* || base.* }` keyed by `source===basePublication` so a stale fetch can't bleed into the next selection. Summary renders immediately, upgrades in place.

**2. JSON `description` is HTML.** OPDS 2.0 keeps the summary in plain `metadata.description` (no typed `<content>`), and pglaf fills it with `<p>...</p>`. `PublicationView` rendered `<p>{description}</p>` → literal tags. Fix: `getOPDSDescriptionHtml(content ?? description)` so the (sanitized) markup renders. See [[bug-patterns]] and prior [[OPDS HTML description (#4503)]] decode-once+sanitize.

**Why:** less data per feed page + faster load; client dereferences on demand.
**How to apply:** when an OPDS publication looks under-populated, check for a `rel:"self"` publication-type link before assuming the feed is the whole record. Related OPDS notes: opds-firefox-strict-xml-4479, opds2-json-search-4502, opds-html-description-4503.
