---
name: cover-stale-inplace-mutation-memo
description: Library cover (or any memoized child) not updating until refresh — in-place object mutation defeats React.memo
metadata: 
  node_type: memory
  type: project
  originSessionId: ec78c172-79e7-448c-8671-780dcc115613
---

Symptom: edit a book's cover in Book Details → Save → return to library, the cover shows the OLD image; a full page refresh fixes it. Title/author DO update.

Root cause: `handleUpdateMetadata` in `src/app/library/page.tsx` mutated the existing `book` object IN PLACE (`book.metadata = …; book.coverImageUrl = …; book.updatedAt = …`) then passed that same reference to `updateBook`. `<BookCover>` (`src/components/BookCover.tsx`) is `React.memo`'d with a custom comparator reading `coverImageUrl`/`metadata.coverImageUrl`/`updatedAt` off the book. Because the previous-render snapshot (`prevProps.book`) is the *same mutated object*, every field compares equal → memo skips → cover never re-renders. Title updates because `BookItem` is NOT memoized. Refresh works because `loadLibraryBooks` (`libraryService.ts`) strips `coverImageUrl` on save and REGENERATES it from `${hash}/cover.png` on load (the file was overwritten by `updateCoverImage`).

KEY INSIGHT: cloning inside `updateBook` would NOT fix it — once the original object is mutated, `prevProps` already reads the new values. The fix must leave the object React holds as `prevProps` untouched.

Fix (PR for fix/txt-open-with-conversion): pure helper `getBookWithUpdatedMetadata(book, metadata)` in `src/utils/book.ts` returns a NEW book object (`{...book, metadata, title, author, primaryLanguage, updatedAt, coverImageUrl}`); `handleUpdateMetadata` uses it instead of mutating. Cover URL is set from `metadata.coverImageBlobUrl || metadata.coverImageUrl` (cached/blob URL is a unique path = the new image; `'_blank'` for remove). Unit test asserts immutability of the input + new reference.

General rule: when a memoized child reads fields off a store object, NEVER mutate that object in place to "update" it — build a new object. Same trap could bite any `React.memo` field comparator in this codebase.

On-device CDP verification (reusable): the cover SET path uses the native Tauri file picker (`selectFiles` → `openDialog`), NOT automatable via CDP; the installed emulator app is the released bundled build (`http://tauri.localhost/...`), not the dev server. So I verified the MECHANISM directly in the live WebView: extracted the zustand library store from the React fiber tree (the library page calls `useLibraryStore()` with NO selector, so its fiber hook `memoizedState` holds the full state incl. `library`/`setLibrary`/`updateBook`), injected an Alice book, then A) mutated it in place + `setLibrary([sameRef])` → rendered `<img src>` stayed stale (bug), B) `setLibrary([{...book,coverImageUrl:NEW}])` → `<img src>` updated immediately (fix). Restore with `Page.reload` (injected book was in-memory only). See [[cdp-android-webview-profiling]], [[android-cdp-e2e-lane]].
