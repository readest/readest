---
name: booknote-view-autoscroll-4352
description: "Annotation/bookmark list (BooknoteView) auto-scroll-to-nearest regression after virtualization (#4352) and its TOCView-mirroring fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: bda988b9-28ec-450f-874e-ee9c104f7603
---

After #4352 virtualized `BooknoteView` (sidebar annotations/bookmarks list,
`src/app/reader/components/sidebar/BooknoteView.tsx`), the list stopped
auto-scrolling to the nearest annotation for the current reading position (it
stranded at the top showing Chapter 1). #4352 replaced the per-item
`useScrollToItem` with a single `virtuosoRef.scrollToIndex`, but missed the
machinery `TOCView` already had. Two distinct failure paths:

1. **Reload (annotations tab active at load; progress arrives AFTER mount):** the
   OverlayScrollbars `initialized` callback (deferred init) resets the wrapped
   viewport `scrollTop` to 0, clobbering the scroll; the `lastScrolledCfiRef`
   guard then blocks any retry. Fix = re-apply `scrollToIndex` to the *current*
   nearest index inside the `initialized` callback, read via a **ref**
   (`nearestIndexRef`) because that callback is the mount-time closure. Double
   rAF (settle the reset, then re-assert once rows are measured).
2. **Tab-switch (open panel while reading; progress KNOWN at mount):** firing a
   `scrollToIndex` synchronously on the freshly mounted, unmeasured list either
   no-ops (`behavior:'smooth'`) or **wedges Virtuoso into rendering nothing**
   (`behavior:'auto'`). Fix = mount Virtuoso *natively* centered via
   `initialTopMostItemIndex` + an `initialScrollHandledRef` gate so the scroll
   effect SKIPS that first jump. This is exactly TOCView's design.

The fix mirrors [[toc-expand-and-autoscroll]] (same OverlayScrollbars-resets-
scrollTop + Virtuoso-lands-short-on-unmeasured-rows pattern). Test:
`src/__tests__/components/BooknoteView.test.tsx` stubs Virtuoso (spy-able
`scrollToIndex`, captures `initialTopMostItemIndex`) and captures the mount-time
`initialized` callback — forcing a ref-based fix (modeled on `TOCView.test.tsx`).

**Dev-server verification gotchas (cost hours here):**
- The `localhost:3000` dev server was running from a *different worktree*
  (`/Users/chrox/dev/readest-fix-4394-bg-gutter-bleed`), not the main checkout.
  Edits weren't compiled until copied into that worktree's path. Check
  `ps aux | grep next-server` for the serving cwd. Book data is per-origin
  (OPFS/IndexedDB on localhost:3000) so you can't verify on another port.
- After ~10 rapid file syncs, **Fast Refresh corrupts the mounted tab's state**
  — identical code that worked started rendering 0 items. A *brand-new tab*
  (close the old one) renders correctly. Always verify in a fresh tab.
- Chrome MCP `javascript_tool` querying `.booknote-item` count catches Virtuoso
  mid-render (returns 0 even when it later paints fine). Trust the *screenshot*
  (the painted frame), not a synchronous DOM count, for virtualized lists.
