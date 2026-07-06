---
name: opds-autodownload-subdir-crawl-4272
description: OPDS auto-download
metadata: 
  node_type: memory
  type: project
  originSessionId: 92b00cca-93fe-4255-bb5f-1db8d3421a35
---

Issue #4272: OPDS auto-download on copyparty missed books in subdirectories (and skipped folders containing only subfolders). Copyparty (`?opds` on any directory) emits subfolders as `rel="subsection"` nav entries (`type="application/atom+xml;profile=opds-catalog"`), files as acquisition entries with `?dl` hrefs, no pagination, no "by newest" feed (template: `copyparty/web/opds.xml`).

**Fix (PR #4948, MERGED 2026-07-06):** in `src/services/opds/feedChecker.ts`, `checkFeedForNewItems` now branches: catalogs WITH a "by newest" feed keep the old behavior (newest feed + rel=next only, never crawl — whole-library subscription hazard); catalogs WITHOUT one are directory-style and get a breadth-first `crawlFeeds` over `getSubsectionURLs` (skips facet/self/up/start/top/search rels and non-catalog types), bounded by `MAX_CRAWL_DEPTH=5`, `MAX_FEEDS_PER_CRAWL=50` (incl. root fetch), and the `visited` set. rel=next pagination still capped at `MAX_PAGES_PER_FEED` per chain. Collected entryIds are added to the local knownIds copy so a book listed by two crawled feeds is collected once (NOT persisted — failed downloads must stay retryable). Tests: `src/__tests__/services/opds-feed-crawl.test.ts` (mocked `fetchWithAuth` serving URL→XML fixtures).

**Unresolved iOS half of #4272:** reporter saw "33 downloads failed" on iPhone while macOS downloaded all base-dir books fine. Same TS/Rust download path both platforms (`download_file` in `src-tauri/src/transfer_file.rs`); most plausible cause is iOS suspending the app mid-sync and killing in-flight reqwest connections (35 epubs at DOWNLOAD_CONCURRENCY=3 takes minutes). Retry/backoff (MAX_RETRY_ATTEMPTS=3) picks them up on later launches, but after 3 failures entries are moved to knownEntryIds and permanently skipped with no recovery UI — a repeatedly-interrupted catalog silently loses books. Possible future work: iOS beginBackgroundTask around the sync, or don't hard-cap retries for network-type errors.

See [[opds-groups-carousel-4750]] · [[download-file-scope-android-regression]].
