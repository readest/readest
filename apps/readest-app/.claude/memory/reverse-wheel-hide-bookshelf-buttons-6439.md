---
name: reverse-wheel-hide-bookshelf-buttons-6439
description: "#6439 Reverse Mouse Wheel + e-ink Hide Bookshelf Buttons (Settings > Behavior > Device); MERGED #6448; library e-ink gate must read GLOBAL isEink"
metadata:
  node_type: memory
  type: project
  originSessionId: 38401240-f888-4965-be8f-7620c710a669
  modified: 2026-09-29T06:24:31.188Z
---

#6439 added two device-local SystemSettings switches in Settings > Behavior > Device, MERGED as PR #6448 (b3b928123) on 2026-09-29, UNRELEASED. Worktree + branch removed. Neither was checked in a running app (unit + browser tests only).

- `reverseWheelPaging`: flips deltaY only, in `usePagination` `iframe-wheel` branch (paginated mode; scrolled mode is native scroll).
- `hideBookshelfPageButtons`: `BookshelfStream` `hidePageButtons` prop drops the bottom Previous/Next bar AND per-carousel Previous/Next; `pageNavigation` stays on so PageDown/hardware keys still page the library.

**Why:** CodeRabbit caught that ControlPanel's `isEink` is BOOK-scoped when a book has `isGlobal: false`, while `Bookshelf` reads `settings.globalViewSettings.isEink`.

**How to apply:** any setting that affects the library must gate on `settings.globalViewSettings`, never ControlPanel's `viewSettings`. Side find, unfixed: `pt` locale has Polish text for "Previous"/"Next".
