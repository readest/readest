---
name: bookshelf-import-menu-popup-5247
description: "Bookshelf \"+\" tile menus need a fixed-position anchored popup, not a dropdown, because the Virtuoso scroller clips dropdown-content (#5222/PR #5247)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2f3342fb-c81c-4ebc-8beb-aa6394a2e8c8
  modified: 2026-07-26T06:35:34.802Z
---

PR #5247 (issue #5222) originally added a full `ImportDialog` modal so the
bookshelf "+" tile and the empty-library "Import Books" button could expose the
same import options as the library header. On 2026-07-26 the maintainer asked to
drop the modal and reuse the existing `ImportMenu` dropdown as a popup instead,
so the branch was reset to origin/main and reimplemented as
`src/app/library/components/ImportMenuPopup.tsx`. MERGED 2026-07-26 (merge commit
a8aa982c8, single commit 787ccb08b co-authored with the contributor).

**Why a popup and not `<Dropdown>`:** the "+" tile is rendered inside
`VirtuosoGrid`, whose scroller is `overflow-y: scroll`. DaisyUI/house
`dropdown-content` is absolutely positioned and gets clipped by that scroller.
The popup therefore renders `position: fixed` (Overlay + menu wrapper, both
z-50, no portal needed since the library page root has no transformed ancestor)
and computes its coordinates from the anchor button's `getBoundingClientRect()`,
flipping above the anchor when there is no room below and clamping to
`safeAreaInsets` bounds. Pass `menuClassName='no-triangle !mt-0'` to `ImportMenu`
so the header's arrow/margin (sized for the header anchor) is dropped.

Entry points report their own anchor: `Bookshelf.handleImportBooks(anchor)` and
`LibraryEmptyState.onImport(anchor)` both take `HTMLElement` (from
`event.currentTarget`); `page.tsx` holds `importMenuAnchor` state and renders one
popup with the same platform gates as `LibraryHeader`.

The Playwright helper `LibraryPage.importBook()` now needs two clicks (button,
then the "From Local File" menuitem) - the empty-state button no longer opens the
file picker directly. Web e2e is flaky at `--workers=4` against a dev server;
`--workers=2` passes clean.

Related: [[library-reader-separate-texture-4743]], [[virtuoso_overlayscrollbars]]
