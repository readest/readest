---
name: opds-fixes
description: "Aggregator of OPDS bug-fix memories (catalog parsing, search, auth, auto-download)"
metadata: 
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
  modified: 2026-08-05T04:09:04.122Z
---

- [[opds-firefox-strict-xml-4479]] — Firefox strict-XML parsing #4479
- [[opds2-json-search-4502]] — OPDS2 JSON search #4502
- [[opds-html-description-4503]] — HTML descriptions #4503
- [[opds-self-link-metadata-4749]] — self-link metadata #4749
- [[opds-popular-catalog-dedup-4782]] — popular catalog dedup #4782
- [[opds-autodownload-subdir-crawl-4272]] — auto-download subdir crawl #4272
- [[opds-preemptive-basic-digest-400]] — preemptive Basic auth vs Digest 400s
- [[opds-autodownload-tls-skipssl-4988]] — auto-download TLS skip-SSL #4988
- [[opds-http-links-on-https-feed-5300]] — HTTPS feed with absolute `http://` self-links #5300 (PR #5324)
- Calibre pipe-escaped authors #5183 (PR #5189, MERGED): Calibre DB stores commas in author names as `|` (`Doe| John`) and Calibre-Web's `feed.xml` emits `{{author.name}}` raw (its HTML templates apply `replace('|',',')`, OPDS template doesn't — server-side, not Readest). Fix: `formatContributorName()` in `opdsUtils.ts` de-escapes `|`→`,`; PublicationCard/PublicationView join multiple authors with ` & ` (Calibre convention) instead of `, `.
- Percent-encoded OpenSearch template #5500 (PR #5504, MERGED): a Nextcloud Calibre2OPDS catalog publishes `<Url template="...?query=%7BsearchTerms%7D">`. foliate's `getOpenSearch` matches placeholders with `/{(?:([^}]+?):)?(.+?)(\?)?}/g` — **literal braces only** — so `params` came back `[]` (empty search form) and `search()` returned the template verbatim; the server then decoded it to a literal `{searchTerms}` ("All books matching: /{searchTerms}/"). Fix: `normalizeOpenSearchTemplates(doc)` in `opdsUtils.ts` decodes only `%7B`/`%7D` on each `Url[template]` before `getOpenSearch`, same "fix up the doc before foliate sees it" shape as `parseOPDSXML`. Decoding only braces (not the whole URL, as the Atom search path's `decodeURIComponent(searchURL)` does) keeps other escapes intact. Note `resolveURL` itself percent-encodes braces via `new URL()`, which is why the Atom path needs its decode. Same class of bug still latent in `expandOPDSSearchTemplate` (OPDS 2.0 JSON), left alone — unreported. Testing gotcha: `opds-utils.test.ts` fully mocks `foliate-js/opds.js`; use `vi.mock(..., async (importOriginal) => ({...(await importOriginal()), isOPDSCatalog: vi.fn(...)}))` to exercise the real parser, and `&amp;` in XML attribute fixtures or DOMParser drops the element.
