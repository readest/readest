---
name: rss-feed-books-not-syncing-5307
description: "#5307 RSS feed subscriptions never reach other devices because feed books are fileless and the peer sync gate requires uploadedAt"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d6b056c-0530-4374-9334-20e607a216cb
  modified: 2026-07-25T01:46:50.819Z
---

# #5307 — RSS feeds only show in the browser where they were added

Reported on web.readest.com 0.11.20, two laptops, same account. Two symptoms, one cause:
manual "upload to cloud" fails immediately, and the feed never appears on the other browser.

**A feed subscription is a fileless Book row.** `createFeedBook` (`src/services/rss/feedBook.ts`)
makes a virtual EPUB with `url = feed://<encoded {feedUrl}>`, `metadata.feedUrl`, `uploadedAt: null`,
`downloadedAt: now`. There is no blob anywhere — `readerStore` rebuilds the book from the feed URL,
and `transformBookFromDB` rehydrates `book.url` from `metadata.feedUrl` on peers.

**Root cause.** `resolveBookContentSource` returns `{kind:'feed'}`, which `isBookFileContentSource`
rejects, so `cloudService.uploadBook` throws `Book file not uploaded` → the queued transfer fails
(that is the visible "sync is failing"). `uploadedAt` therefore stays null forever. The row's
METADATA does reach the cloud (verified: `getNewBooks` pushes it, the server pull has no
`uploaded_at` filter) — but `useBooksSync.updateLibrary`'s new-book filter required
`newBook.uploadedAt`, a guard that exists so a peer never shelves a book whose file it cannot
fetch. A feed book needs no file, so it was silently dropped on every device but the origin.

**Fix.** New predicate `isFeedBook(book)` in `services/rss/feedBookUrl.ts`, applied at the places
that reason about a book's FILE:
- `useBooksSync.updateLibrary` — `(newBook.uploadedAt || isFeedBook(newBook))` (the actual sync fix)
- `getBookContextMenuItemIds` — no download/upload/share
- `BookItem` shelf cloud badge, `TransferQueuePanel` "Upload All", `BookDetailView` upload button
- `processNewBook` regenerates the cover locally via new `ensureFeedBookCover` (extracted from
  `handleAddFeedSubmit`) — the cover is derived from feedUrl+title, and there is no cloud copy to
  download because `uploadBook` never ran.

**Rejected alternatives:** stamping `uploadedAt` at creation (peers would then offer Download and
fetch a nonexistent file); setting `downloadedAt: null` instead (implicit, and does not fix feed
books already in users' libraries).

**Notes for future work:** feed books degrade gracefully on file-sync backends (WebDAV/Drive/S3) —
`pushBookFile` resolves `no-source` and skips. `ShareBookDialog` was already safe: `shareEnabled`
gates on `fileSize !== null`. `FeedsView` + `feedStore` (`Settings/feeds.json`) appear to be dead
code — `handleShowFeeds` opens `AddFeedModal`, nothing sets `showFeeds`; per-item read state is
therefore not synced at all. Related: [[opds-catalog-reincarnate-restart-5180]],
[[demo-books-cloud-sync-5049]].
