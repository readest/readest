---
name: toc-current-position-row
description: "TOC \"Current position\" row showing the live reading page under the active item"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c3a3d3c-86fe-4f6a-b539-8bf8052d68bd
---

The TOC sidebar shows a synthetic "Current position" row (open-book `FiBookOpen` icon + `_('Current position')` label + live page number) directly under the highlighted/active TOC item, indented one level deeper. The row is **clickable** → navigates to `progress.location` (the exact current reading CFI, more precise than the section header which goes to section start); passes `onClick` from TOCView's `handleCurrentPositionClick` which dispatches `navigate` + `view.goTo(location)` (mirrors `BooknoteItem`). Page number uses the ordinary muted `text-base-content/50` (NOT the blue highlight — explicit user ask); icon + label stay highlighted.

`'Current position'` was ALREADY an existing i18n key (used by `src/app/reader/hooks/kosyncPreview.ts`), translated in all 33 locales — reusing it needed no new translation.

Key files:
- `src/app/reader/components/sidebar/TOCItem.tsx` — `CurrentPositionRow` component + pure helpers `buildTOCDisplayItems(flatItems, activeHref, currentPage)`, `isCurrentPositionItem`, types `CurrentPositionItem`/`TOCDisplayItem`.
- `src/app/reader/components/sidebar/TOCView.tsx` — `displayItems = useMemo(buildTOCDisplayItems(flatItems, activeHref, progress?.page))`; Virtuoso renders `displayItems` (totalCount + itemContent discriminates on `isCurrentPositionItem`).

Design facts:
- Page number = `progress.page` (already `pageInfo.current + 1`, resolves fixed-layout vs reflowable). Same scale as the per-item page numbers (`item.location.current + 1` / `item.index + 1`). The active section header shows its START page; the current-position row shows the LIVE page, so the gap = how far into the section you are.
- Indent: synthetic row depth = `activeItem.depth + 1`, rendered with the same `(depth + 1) * 12` formula → matches a child item's indent.
- Highlight reuses the active-item classes (`text-bold-in-eink sm:bg-base-300/65 sm:text-base-content text-blue-500`) so eink behavior is already covered. Icon inherits `currentColor`.

**INVARIANT (do not break):** the row is inserted *after* the active item, so the active item's index in `displayItems` equals its index in `flatItems`. This is why the auto-scroll effects (which still `flatItems.findIndex(...).scrollToIndex`) keep working untouched. If you ever insert anything BEFORE the active item, the scroll-to-active index math breaks. See [[toc-expand-and-autoscroll]] and [[booknote-view-autoscroll-4352]].

Tests: `src/__tests__/components/TOCItem.test.tsx` (`CurrentPositionRow` + `buildTOCDisplayItems` suites). 'Current position' is a non-plural string → no en/translation.json entry needed ([[feedback_en_plurals_manual]]).
