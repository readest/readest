---
name: opds-groups-carousel-4750
description: OPDS feed groups (>=2) render as horizontal virtualized carousels with lazy cover loading
metadata: 
  node_type: memory
  type: project
  originSessionId: 3073b2b0-8219-42cc-8e3f-547715b86b01
---

#4750 (PR #4755, merged): when an OPDS `feed.groups.length >= 2`, `FeedView` renders each group's publications/navigation as a horizontal carousel (`src/app/opds/components/GroupCarousel.tsx`) instead of the grid; single-group feeds keep the grid. Matches Thorium.

`GroupCarousel` wraps a horizontal `react-virtuoso` `Virtuoso` (`horizontalDirection`), so only in-view items mount → covers load lazily as you scroll (verified via network: ~12 covers/group fetched regardless of group size; far-right items fetch only after scrolling to them).

Gotchas (cost real debugging):
- `VirtuosoHandle.scrollBy({left})` is a **no-op** in horizontal mode (the handle maps to the vertical axis). Page the arrows by **index** via `scrollToIndex({index, align, behavior})`, tracking the visible range from `rangeChanged`.
- Virtuoso sizes the horizontal track **lazily**, so a pixel `scrollBy` on the scroller element clamps to the currently-rendered width — another reason to scroll by index.
- Arrow visibility comes from `atTopStateChange`/`atBottomStateChange` (top=left, bottom=right). Row height is measured from the first `[data-carousel-item]`; arrows are vertically centered on the cover by measuring the first `<figure>` (cards have title/author below, so centering on the whole row looks low).
- Scrollbar hidden via a scoped `.no-scrollbar` util in `globals.css`; arrows use `eink-bordered`.
- Tests must mock `react-virtuoso` (jsdom has no layout) like the TOCView/BooknoteView tests — render all items via `itemContent`.

`PublicationCard` (shared by carousel + grids) got rounded covers (`overflow-hidden rounded`, matching the library bookshelf) and dropped the inline acquisition/price badge — that badge still renders on the detail page (`PublicationView`).

Related: [[virtuoso_overlayscrollbars]].
