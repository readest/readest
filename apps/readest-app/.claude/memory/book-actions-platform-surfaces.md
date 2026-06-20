---
name: book-actions-platform-surfaces
description: Where to add a library book action so it reaches every platform (context menu is desktop-only)
metadata: 
  node_type: memory
  type: project
  originSessionId: 4efb7b40-cce1-4742-9730-7e93e643d196
---

The library book **context menu** (`BookshelfItem.tsx::bookContextMenuHandler`, native `Menu.new`) only renders where `appService.hasContextMenu` is true — that is **Tauri desktop only** (`nativeAppService.ts`: `!(ios||android)`). It is **false on web AND on iOS/Android**. So a book action added only to the context menu (+ `getBookContextMenuItemIds` in `libraryUtils.ts`) never reaches phone/web users.

The cross-platform home for book-level actions is the **`BookDetailView` action-icon row** (`src/components/metadata/BookDetailView.tsx`), shown in `BookDetailModal`, reachable on every platform (BookItem tap → details, `Bookshelf.tsx::handleShowDetailsBook`). That row is `flex-nowrap` inside a fixed `h-32` column and already holds up to ~5 icons (Edit/Delete/Download/Upload/Export) — adding more risks phone overflow; keep additions to one small icon.

**Rule:** desktop-only fast path → context menu; must reach mobile → BookDetailView (or both). Example: the "Search on Goodreads" feature (#4543) added both — `searchGoodreads` context-menu id + a `FaGoodreads` button in BookDetailView, opening `getGoodreadsSearchUrl` via [[open-external-url-helper]]. In-reader highlighted-text Goodreads search is a built-in [[web-search-provider]] entry instead.
