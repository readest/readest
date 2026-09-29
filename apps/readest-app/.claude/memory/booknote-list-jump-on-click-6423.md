---
name: booknote-list-jump-on-click-6423
description: "#6423 annotations sidebar jumped when clicking a visible highlight; MERGED #6468 (e43651097); scroll-while-idle jump half UNFIXED; web seeding recipe for many highlights"
metadata:
  node_type: memory
  type: project
  originSessionId: 1056f95f-786b-478d-b063-bfd78c154c45
  modified: 2026-09-29T15:29:31.596Z
---

#6423: clicking a highlight in the sidebar Annotations panel moved the reading position, and `BooknoteView`'s auto-scroll effect re-centered on the nearest note every time, even when it was already on screen. Fix = skip `scrollToIndex` when the `[data-index]` row is fully inside the Virtuoso scroller. MERGED #6468 (e43651097), Chrome-verified on the web dev build. The issue's second half (list jumps while scrolling without clicking) was NOT reproduced or fixed.

Same PR hardened a flaky `library.browser.test.tsx` "fills the library width at 375px" case: Bookshelf OverlayScrollbars `defer` creates the viewport in an idle callback that CI can hold past waitFor's 1s default; waitFor timeout now 5s.

**Why:** reusable recipe for verifying sidebar/annotation UI on web without clicking dozens of highlights.
**How to apply:** web import = patch `HTMLInputElement.prototype.click` and fire `this.onchange` in a setTimeout (useFileSelector assigns onchange AFTER click()). Seed highlights: compute CFIs in the reader via `foliate-view.book.sections[i].createDocument()` + `view.getCFI(i, range)`, stash in localStorage, then write `booknotes` into IndexedDB `AppFileSystem/files` `Readest/Books/<hash>/config.json` FROM /library — writing while the reader is open gets clobbered by its save on unload. Measure row positions with getBoundingClientRect, not scrollTop (OverlayScrollbars swaps the scroller). See [[next16-dev-lock-and-chrome-verify]].
