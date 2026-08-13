---
name: home-end-book-jump-5660
description: "#5660 Home/End jump to start/end of book: goToFraction covers every layout, and the view is registered in the store before its opening navigation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 53c67aa8-756b-4f6f-bd6b-972d92849b92
  modified: 2026-08-13T08:02:24.362Z
---

#5660 (FR: bind Home/End). **MERGED** 2026-08-13 as `1cbab73f9` (PR #5673); worktree removed.
`onGoBookStart` = `Home`, `onGoBookEnd` = `End`, both in the Navigation section of
`src/helpers/shortcuts.ts`, handled in `useBookShortcuts.ts`.

**One call covers everything.** `view.goToFraction(0 | 1)` works for reflowable *and* fixed-layout
(PDF/CBZ/FXL EPUB) in both paginated and scrolled modes. `#sectionProgress` — which `goToFraction`
needs — exists whenever the book has `splitTOCHref` + `getTOCFragment`, and `pdf.js`/`comic-book.js`
both define them, so the `isFixedLayout` branch that `PageJumpInput` uses (`view.goTo(index)`) is
NOT needed here. `getSection(1)` returns `[lastSection, 1]`; FXL's `goTo` ignores the anchor and
resolves the spread by index.

**The view is live in the store before it is positioned.** `FoliateViewer` calls
`setFoliateView(bookKey, view)` right after `await view.open(bookDoc)` and *before*
`await view.init({ lastLocation })` / `goToFraction(0)`. So `getView()` returns a usable view during
the spinner, and any jump fired then is silently overridden by the opening navigation — after
pointlessly paging in the far end of the book. Guard absolute jumps on
`getViewState(key)?.inited` (set by `setViewInited` right after init).

**"66 / 68" at the true end of a paginated EPUB is not a bug.** The footer's location is computed
from the *start* fraction of the visible page (`getProgress(index, fraction, size)`), so the last
spread reads short of the total. Confirm the real end with `renderer.start + size ≈ viewSize` or by
checking that `view.next()` is a no-op — `renderer.atEnd` and `renderer.page`/`pages` disagree there
and are NOT reliable.

See [[browser-verify-readest-web-recipe]] for the dev-server PDF latency trap hit while verifying this.
