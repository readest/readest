---
name: annotations-toolbar-count-summary-5576
description: "Sidebar annotations toolbar summary line (MERGED #5576) and the two non-obvious rules it exposed: the untrimmed note-body split and the single shared isSearchBarVisible flag"
metadata: 
  node_type: memory
  type: project
  originSessionId: c519df0b-3b66-4486-a745-638b678a3573
  modified: 2026-08-08T06:51:24.876Z
---

MERGED #5576 (2026-08-08, merge `ada70fc2f`). The annotations toolbar row rendered only the
filter button when search was closed, so everything left of it was empty. It now carries a
summary: `145 Highlights - 6 Notes` at rest, one term when the other kind is zero,
`6 of 151` while any filter/query narrows the list, nothing when the book has zero
annotations or when the search field is open.

**The note-vs-highlight split is untrimmed and load-bearing.** `filterBooknotes` partitions on
`note.note` truthiness with no `trim()`, so a whitespace-only body counts as a *note*.
`summarizeAnnotations` deliberately copies that rule so the count can never disagree with what
the Highlights/Notes chips select. `decideNoteBubbleTransition` in the same file *does* trim,
so a `'   '` body counts as a note in the sidebar but paints no bubble in the reader. That
inconsistency is pre-existing and still there; if you ever "fix" one side, fix all three or the
count and the chips drift apart.

**One search flag feeds two search bars.** The sidebar header's search icon toggles a single
`isSearchBarVisible` in `sidebarStore`, and BOTH the sidebar's book-content `SearchBar` and the
annotations toolbar consume it. Opening it therefore shows two search fields at once and pushes
the sidebar content down ~48px. When you measure "did my row change height?", that 48px is the
book-search bar appearing above, not your row. Pre-existing, no issue filed.

**Keep `justify-end` on `.annotations-toolbar`.** `justify-between` looks right while a summary
renders, but with zero annotations the filter Dropdown is the row's only child and would jump to
the leading edge. The summary carries `flex-1 min-w-0 truncate` instead, which pushes the button
right in every populated state.

Styling matches the existing `{{count}} results` line in `SearchResults.tsx`: `text-xs`
`text-base-content/60`, plus `tabular-nums` and a fixed `h-8` so the row neither jitters nor
changes height between search open/closed.

See [[browser-verify-readest-web-recipe]] for how this was checked in Chrome, and
[[paragraph-layout-has-allowlist-trap]] for other annotator-adjacent traps.
