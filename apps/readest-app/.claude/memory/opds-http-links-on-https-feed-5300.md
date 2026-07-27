---
name: opds-http-links-on-https-feed-5300
description: "#5300 OPDS sub-feeds 404 when an HTTPS catalog publishes absolute http:// self-links; resolveURL upgrades same-host links (PR #5324)"
metadata:
  type: project
---

`bookserver.mek.oszk.hu` (Magyar Elektronikus Konyvtar) serves its OPDS catalog
fine over HTTPS but every `<link href>` in the feed is an absolute
`http://bookserver.mek.oszk.hu/...` URL. Its plain-HTTP vhost 301-redirects to a
**different** host (`https://balassi.oszk.hu/<path>`) which 404s, so the root
loaded and every sub-feed, cover and acquisition link below it failed.

**Why:** Not a regression in Readest -- `v0.11.17` reproduces too. Absolute
links win over the base URL in `new URL(url, base)`, so `resolveURL` handed the
`http://` URL straight to the fetch layer.

**How to apply:** `resolveURL()` in `src/app/opds/utils/opdsUtils.ts` is the one
choke point turning feed hrefs into request URLs (page.tsx, FeedView,
PublicationView, NavigationCard, feedChecker, autoDownload all route through
it). It now upgrades `http:` -> `https:` when the base was fetched over HTTPS
**and** `resolved.host === base.host` -- the same upgrade browsers apply to
mixed content. Compare `host` (not `hostname`) so a port mismatch blocks the
upgrade; leave cross-host and http-base cases alone so it can never retarget or
downgrade a request. `baseURL` is `responseURL` (the URL actually fetched), so
once one link upgrades the whole subtree stays on HTTPS.

Search on that catalog is still broken, and not by anything Readest can fix:
`opensearch.xml` templates `http://mek.oszk.hu/opds/opensearch/?q={searchTerms}`,
which 404s over **both** schemes and on both hosts. Different host, so the
same-host rule deliberately leaves it alone.

Related: [[opds-fixes]], [[opds-firefox-strict-xml-4479]] (the earlier "OPDS
loading" bug #5300 was filed against).
