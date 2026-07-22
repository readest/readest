---
name: opds-fixes
description: "Aggregator of OPDS bug-fix memories (catalog parsing, search, auth, auto-download)"
metadata: 
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
---

- [[opds-firefox-strict-xml-4479]] — Firefox strict-XML parsing #4479
- [[opds2-json-search-4502]] — OPDS2 JSON search #4502
- [[opds-html-description-4503]] — HTML descriptions #4503
- [[opds-self-link-metadata-4749]] — self-link metadata #4749
- [[opds-popular-catalog-dedup-4782]] — popular catalog dedup #4782
- [[opds-autodownload-subdir-crawl-4272]] — auto-download subdir crawl #4272
- [[opds-preemptive-basic-digest-400]] — preemptive Basic auth vs Digest 400s
- [[opds-autodownload-tls-skipssl-4988]] — auto-download TLS skip-SSL #4988
- Calibre pipe-escaped authors #5183 (PR #5189, MERGED): Calibre DB stores commas in author names as `|` (`Doe| John`) and Calibre-Web's `feed.xml` emits `{{author.name}}` raw (its HTML templates apply `replace('|',',')`, OPDS template doesn't — server-side, not Readest). Fix: `formatContributorName()` in `opdsUtils.ts` de-escapes `|`→`,`; PublicationCard/PublicationView join multiple authors with ` & ` (Calibre convention) instead of `, `.
