---
name: rtl-book-direction-from-language
description: "Hebrew/Arabic books already go RTL from dc:language (getBookDirFromLanguage); UI RTL is menu-only by owner choice — check before accepting \"RTL support\" PRs"
metadata:
  node_type: memory
  type: project
  originSessionId: 756a9102-ce1b-4df2-80a7-57746c61a7d1
  modified: 2026-11-15T16:11:13.238Z
---

Main already renders a book RTL when its metadata language is RTL (`getBookDirFromLanguage` in `FoliateViewer.tsx` openBook sets `bookDoc.dir`), even with no `dir` attribute in the XHTML. A converted TXT gets `dc:language` from franc, so Hebrew TXT is RTL too. Verified in Chrome on dev-web 2026-11-15 (#7478).

The owner chose to keep the Hebrew/Arabic UI as menu-only RTL via the `ui-rtl` class (#2327) and NOT set `dir="rtl"` on `<html>` (re-confirmed 2026-11-15 when narrowing #7478).

**Why:** #7478 claimed to add RTL for Hebrew books, but on main they were already RTL. Its content-sniffing (`any Hebrew char → rtl`) flipped English books that quote one Hebrew word, and `text-align: right !important` broke justification (#6636 test).

**How to apply:** for any "RTL support" PR, first open the same book on main with a `lang="he"` test EPUB. Reject content-based direction sniffing and alignment overrides in `style.ts`. Root `dir` is a product decision for the owner.
