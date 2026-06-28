---
name: multiwindow-settings-clobber-4580
description: Pagination/global settings revert with multiple desktop windows; cross-window broadcast fix
metadata: 
  node_type: memory
  type: project
  originSessionId: 4df1808d-e106-4316-9206-b4e606b4b9bf
---

Issue #4580 (fix: PR #4803, branch `fix/multiwindow-settings-revert-4580`): on desktop (Tauri) global view settings (Click/Swipe to Paginate, Show Page Navigation Buttons) "revert to default" — only when multiple windows are open (OP ran `1 + n_opened_books` windows).

**Root cause:** each Tauri window keeps its own in-memory `useSettingsStore.settings`, loaded once at window open. Global settings persist to ONE shared `settings.json`, and every window writes the WHOLE object via the store's `saveSettings`. A window opened before the user customized a global setting holds the default (e.g. `disableClick=false`); when it later saves (notably `handleCloseBooks` on reader-window close in `ReaderContent.tsx`, but ANY settings write) it clobbers the user's value back to default. Explains "reverts to *default*, only with multiple windows". Note: `replicaCursorStore` avoids this by load-modify-saving from disk each time.

**Fix:** cross-window broadcast. `src/utils/settingsSync.ts` (`broadcastGlobalSettings` emits `global-settings-window-sync` with `sourceLabel` + the two global blobs; `subscribeSettingsSync` ignores self; `mergeSyncedGlobalSettings` adopts `globalViewSettings`/`globalReadSettings` and preserves all device/window-local fields). Store `saveSettings` calls `broadcastGlobalSettings` after persisting. `useSettingsSync` (mounted in `Providers.tsx`, the shared root for both library + reader windows) adopts broadcasts via `setSettings`. No-op off Tauri.

Only the two global objects are synced (minimal scope) — covers the reported bug + sibling read settings; top-level scalars left window-local. No save/broadcast loop: receive calls `setSettings` only; the replica publisher subscriber pushes to network (no disk write) and pagination fields aren't in `SETTINGS_WHITELIST` anyway. Live cross-window view update of already-open books is intentionally NOT done (bug is persistence, not live propagation). Related: [[webdav-connect-nullified-4780]] (stale settings closure), [[window-state-sanitize-4398]].
