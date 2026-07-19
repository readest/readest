---
name: select-mode-actions-overlap-last-book-5175
description: "#5175 list-mode select bar hides last book; measure bar height into Virtuoso Footer spacer"
metadata: 
  node_type: memory
  type: project
  originSessionId: e9a706a9-3417-4bf5-9369-8e34fcc3735d
---

Issue #5175: in library **list mode**, selecting a book shows the fixed bottom
`SelectModeActions` bar (`fixed bottom-0 z-40`, `Bookshelf.tsx`), which overlaps
the last book when scrolled to the end — the last row is unreachable behind the
bar. Root cause: the Virtuoso `Footer` reserved only a hardcoded 34px of trailing
space, far less than the bar's real height (≈88px single-row, taller when it wraps
to 2 rows on narrow/mobile widths at `max-[500px]`, plus `safeAreaBottom + 16`).

Fix (branch `dev`, not yet PR'd as of 2026-07-19):
- `SelectModeActions` gets an `onHeightChange?(h)` prop; measures its own fixed
  root via `getBoundingClientRect().height` + a `ResizeObserver`, reports 0 on
  unmount. Reused the single root ref by passing `elementRef` to
  `useKeyDownActions` (that hook accepts `elementRef`).
- `Bookshelf` stores it in `selectModeActionsHeight` state and computes
  `footerHeight = h > 0 ? h + 34 : 34`, fed through `BookshelfListContext`.
- **Gotcha:** the Virtuoso `Footer`/`List`/`Header` are MODULE-LEVEL constants
  (`GRID_/LIST_VIRTUOSO_COMPONENTS`) to keep Virtuoso component identity stable —
  do NOT recreate them per render. Dynamic sizing must flow through `context`
  (`BookshelfFooter` reads `context.footerHeight`). Same footer field fixes both
  grid and list mode (both share `listContext`).
- **Why measure instead of hardcode:** the bar height varies with safe-area inset
  and 1-vs-2-row wrapping; `ResizeObserver` keeps the reserved space correct
  across orientation/width changes. Verified in Chrome: footer spacer = 122px
  (88 + 34) in select mode, last book clears the bar; unit test
  `select-mode-actions.test.tsx` locks in report-on-mount / reset-on-unmount /
  re-report-on-resize (jsdom has no layout, so it fakes `getBoundingClientRect`).

Related: [[list-view-series-overflow-4796]].
