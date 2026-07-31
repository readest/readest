---
name: autohide-cursor-5178
description: "#5178 auto-hide cursor while reading: dormant foliate CursorAutohider wired via autohide-cursor attribute; new saveReadSettings helper"
metadata: 
  node_type: memory
  type: project
  originSessionId: addade3c-5f1b-4ea1-a310-0aed37c4baf7
  modified: 2026-07-31T05:11:05.603Z
---

Issue #5178 (auto-hide mouse cursor while reading) was ~80% pre-built and dormant:
`ReadSettings.autohideCursor` existed (default `true`, zero consumers) and foliate-js
ships a complete `CursorAutohider` (`packages/foliate-js/view.js`) gated on the
`autohide-cursor` attribute — on the **view element itself, NOT `view.renderer`** —
re-checked lazily on every mousemove, so runtime toggling needs no view recreation.
Its screenX/screenY comparison already filters the synthetic mousemove Chrome fires
when content scrolls/turns under a stationary pointer (the issue's "don't reappear
on scroll/page-turn" requirement). Clones attach per section doc with shared state.

MERGED via PR #5404 (merge 6a3caabeb, 2026-07-31; verified live in Chrome via dev-web; worktree and branches cleaned up):
- FoliateViewer init: `view.toggleAttribute('autohide-cursor', !isMobile && setting)`
- ControlPanel Device section toggle (gated `!appService?.isMobile` = desktop app + desktop web),
  effect pushes the attribute to all open views via `readerStore.getViews()`
- `autohideCursor` MOVED from `ReadSettings` to top-level `SystemSettings` (owner request):
  it is per-device, NOT in `SETTINGS_WHITELIST` (src/services/sync/adapters/settings.ts), so plain
  `saveSysSettings` suffices and the interim `saveReadSettings` helper was deleted. Migration-free:
  `loadSettings` merges `{...DEFAULT_SYSTEM_SETTINGS, ...stored}`; stale nested key ignored.
  Reminder: `saveSysSettings`/WordLensPanel write in place with the SAME settings reference, which
  bypasses the replica-push identity-compare subscriber — only matters for whitelisted fields
  (`userStylesheet` et al. use saveViewSettings' new-reference global path)
- Contract test `src/__tests__/reader/autohide-cursor.test.ts` pins the foliate behavior
  against the real `foliate-view` element in jsdom (importable without paginator mocks
  when `open()` is not called)

Note: setting defaults to `true`, so desktop users get auto-hide enabled after update —
flagged for maintainer decision in the PR.
