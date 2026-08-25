---
name: book-cover-fullscreen-viewer-5813
description: "#5813 tap sidebar/Book Details cover to open it full screen in ImageViewer; MERGED #5827 (279698832), worktree removed; web verified, device verify pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: e0ddbb1f-014d-457d-9e46-0e418e33a954
  modified: 2026-08-22T18:54:55.700Z
---

Issue #5813 (FR: display book cover full screen). PR #5827 MERGED 2026-08-23
(merge commit `279698832`, branch `feat/book-cover-fullscreen-5813`, worktree
REMOVED). Pre-push hook
flaked once on `library-search-ssr.test.ts` (NodeFilter leaked into a
`@vitest-environment node` file; passes alone and on retry, unrelated).
Web (localhost dev-web) verified: sidebar
BookCard cover and Book Details cover both open the reader's ImageViewer
above the sidebar / dialog; closing returns with page position intact.
Android/iOS verify PENDING (iOS: cover is fetched from its `asset://` URL via
`convertBlobUrlToDataUrl`; RemoteFile already fetches asset URLs on desktop,
but iOS skips RemoteFile for picker files "to avoid fetch/HEAD issues").

**Design:** `src/components/BookCoverViewer.tsx` = `useBookCoverViewer(book)`
hook (`coverSrc/openCoverViewer/closeCoverViewer`, loads
`metadata.coverImageUrl || coverImageUrl`, NOT the library thumbnail, and
respects `libraryHideCovers`) + `BookCoverViewer` component that renders
`ImageViewer` inside `ModalPortal showOverlay={false}` (z-120 top modal
layer) with `useThemeStore().safeAreaInsets` as gridInsets. The cover wrappers
in `BookCard.tsx` / `BookDetailView.tsx` became `<button aria-label="View Book
Cover">`. i18n key added manually to all 34 locales (no scanner churn).

**Non-obvious findings:**
- `ImageViewer` does NOT close on a synthetic `keydown Escape` dispatched on
  its focused container (its `onKeyDown` calls `e.stopPropagation()`, and
  `useKeyDownActions` listens on `window`); same for the in-book viewer, so
  it is PRE-EXISTING, not a cover-viewer bug. Real-key behaviour unverified
  (Chrome-MCP `key Escape` only blurs).
- Runtime aria-labels are translated: in a zh-CN UI
  `[aria-label="Image viewer"]` matches nothing; query by class
  (`.image-viewer-overlay`) or `body > div[data-capture-blocking-overlay]`.
- Web QA recipe: the signed-in library syncs across ports, so
  `pnpm dev-web --port 3001` in a worktree shows the same books as :3000
  (covers/files load lazily). The import file input is created off-DOM
  (`selectFileWeb`), so Chrome-MCP `file_upload` cannot reach it; patching
  `document.createElement('input').click` + a CORS file server works.
- Chrome-MCP clicks right after a dialog opens can miss (layout still
  settling); re-click or use `element.click()` via javascript_tool.

**How to apply:** after merge, verify on Xiaomi (sidebar is `position: fixed`
full-width on mobile) and iOS (asset fetch). Related:
[[feedback-always-verify-on-xiaomi]], [[ios-imageviewer-zoom-blur-5633]].


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5813 cover full screen from sidebar/Book Details](book-cover-fullscreen-viewer-5813.md) MERGED #5827, worktree removed; web verified, device verify pending; ImageViewer Escape = pre-existing; aria-labels are translated (don't select by English label)
