---
name: opds-autodownload-dev-web-recipe
description: "How to reproduce OPDS auto-download (subscription sync) on dev-web with Playwright and a local Python feed; feeds are browser-cached 5 min, clear via CDP"
metadata:
  node_type: memory
  type: reference
  originSessionId: 53d9e73f-2ff6-437a-8ba8-336df407f7e7
  modified: 2026-11-17T04:01:05.991Z
---

Used for #7509 / #7489 (2026-11-17) to check opds.db contention and retry URLs in a real browser.

- Feed: a local Python `http.server` on 127.0.0.1 (use the IP in the catalog URL). The dev-mode proxy allows private hosts (`NODE_ENV=development`). A root feed with a `rel="http://opds-spec.org/sort/new"` link makes the checker use only that sub-feed, which is the Calibre-Web pattern. A custom handler can return 500 on the first download and drop the entry from the feed after the first request.
- Catalog injection: settings live in IndexedDB `AppFileSystem` / store `files`, keyed by path. Wait until a key ending in `settings.json` exists, add `opdsCatalogs: [{ id, name, url, autoDownload: true }]`, then reload. Sync runs once the library loads. Subscription state is at `Readest/OPDS/<catalogId>.json` in the same store; edit `knownEntryIds` or `failedEntries[].lastAttemptAt = 0` there to force rediscovery or a retry.
- **The proxy lets the browser cache catalog feeds for 5 minutes.** A second sync reuses the old feed unless you send `Network.clearBrowserCache` over a CDP session first. Without that, a "retry" test passes for the wrong reason.
- Count console lines: `[OPDS] imported`, `already imported for this source` (gate hit), `identity gate failed`, `failed to update source map`.
- A fresh profile has an empty library, so `findBookByOPDSSources` returns early without opening the DB. Exercise the gate with a second sync.
- Run the "before" side by copying the file from `git show HEAD:...` and back. Never stash ([[feedback-stash-shared-across-worktrees]]).

Related: [[rsvp-playwright-dev-web-recipe]], [[kosync-dev-web-mock-server-recipe]].
