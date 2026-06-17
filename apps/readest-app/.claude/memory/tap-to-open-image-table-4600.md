---
name: tap-to-open-image-table-4600
description: Single-tap opens image gallery / table zoom in reflowable EPUBs; the iframe-long-press message was renamed to iframe-open-media
metadata: 
  node_type: memory
  type: project
  originSessionId: a41b6cab-c0f3-4740-a4c0-61a10b68fc09
---

PR #4600 (motivated by [[issue-4584-tap-death-investigation]]). In **reflowable**
EPUBs a single tap on an `<img>` / `<svg>`-with-`<image>` / `<table>` now opens the
`ImageViewer` (gallery) / `TableViewer` (zoom), in addition to long-press.

- **Fixed-layout** (PDF/comics/manga, `bookData.isFixedLayout`) keeps tap-to-turn —
  there the tap IS the page-turn gesture.
- **Long-press** is unchanged everywhere; **linked images** (inside `<a>`) still
  follow the link (the existing `sup, a, audio, video` skip).

Impl in `src/app/reader/utils/iframeEventHandlers.ts`:
- New shared `detectMediaTarget(el) -> {elementType:'image',src} | {elementType:'table',html} | null`,
  used by BOTH `handleLongPress` and the new single-tap branch in `postSingleClick`.
- The single-tap branch sits AFTER the link/footnote/`isMouseDown`/`!longHoldTimeout`/
  Word-Lens-gloss guards, so drag/long-hold/double-tap can't double-trigger; it rides
  the 250ms double-click deferral.
- `handleClick` gained an `isFixedLayout` param, passed from `FoliateViewer`
  `docLoadHandler` via `!!bookData?.isFixedLayout`.

**RENAME gotcha:** the window message `iframe-long-press` is now **`iframe-open-media`**
(it fires for both gestures). Consumer hook `useLongPressEvent` → **`useOpenMediaEvent`**
(internal handler `handleOpenMedia`). The long-press DETECTOR
`addLongPressListeners`/`handleLongPress` keeps its name (it still detects a real
long-press). Search `iframe-open-media`, not `iframe-long-press`.
