---
name: open-book-in-reader-skips-guarded-close
description: UNFIXED; switching books via open-book-in-reader skips the notebook recovery check and saveConfigAndCloseBook
metadata:
  type: project
---

`useBooksManager.openBookInReader` replaces `bookKeys` directly when the target book isn't open. It does not run `ReaderContent`'s `runNotebookTransition` or `saveConfigAndCloseBook`, so the old book gets no notebook recovery warning, no final config save, and its view state stays in the store. Found by reading the code on 2026-11-06 (CodeRabbit on #7348); not reproduced.

**Why:** deep links always had this path, but #7348 (merged 2026-11-05 as 2fec8231e) made it reachable from the reader's Vocabulary dialog through "Open in book" on an occurrence from another book, which is a far more ordinary action.

**How to apply:** a fix should route the switch through the guarded close. Also open from #7348: the same-book path leaves the old `cfi` in the URL, and `settings.control.alwaysShowStatusBar` shows in desktop search because settings items have no platform filter.
