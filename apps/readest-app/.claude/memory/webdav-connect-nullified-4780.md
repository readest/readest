---
name: webdav-connect-nullified-4780
description: "WebDAV connection lost after app restart (#4780) — useSync pull finally saved stale closure settings"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5a1fa597-f371-4023-a342-2b04a4ad5cd5
---

# WebDAV "doesn't connect persistently" (#4780)

**Symptom:** Settings → Integration → WebDAV connects fine, but after closing and
reopening the app the connection reads back as "Not connected". Reported on
Android 16 (Motorola RAZR 50), "Latest" version.

**Root cause:** `src/hooks/useSync.ts` `pullChanges` persisted the **stale
hook-closure `settings`** (destructured at line ~63 per render), not the live
store state. The author had already fixed the in-`try` `setSettings` path by
re-reading `useSettingsStore.getState().settings` (block-scoped `const settings`
inside the try), but the `catch` (`Not authenticated` → `keepLogin=false`) and
the `finally` (`saveSettings(envConfig, settings)`) still wrote the stale outer
closure. When a settings change lands **during an in-flight pull** — most
visibly a WebDAV connect — the pull's `finally` overwrites `settings.json` on
disk with the pre-change snapshot, wiping the connect.

**Why WebDAV specifically / why Android / why "consistent":**
- WebDAV is the **only integration credential NOT in the replica
  `SETTINGS_WHITELIST`** (`src/services/sync/adapters/settings.ts`). kosync /
  readwise / hardcover get re-hydrated from the server replica on next launch
  (`applyRemoteSettings`), so a local clobber is invisible for them. WebDAV has
  no server copy → the clobber sticks.
- Only fires for **logged-in** users — all `useSync` pulls are gated on `user`
  (`useBooksSync.ts`: `pullLibrary` runs on library mount, `handleAutoSync`
  periodically). A WebDAV-only user with no Readest account never hits it.
- Android's slower network/IO widens the `await syncClient.pullChanges(...)`
  window, so connecting right after opening the app reliably overlaps the
  mount-pull → appears consistent. On fast desktop the window is ~µs.

**Fix:** in `pullChanges`, read live state in BOTH the catch (`const latest =
useSettingsStore.getState().settings`) and the finally
(`saveSettings(envConfig, useSettingsStore.getState().settings)`). General fix —
preserves any concurrent settings change, not just WebDAV.

**Test:** `src/__tests__/hooks/useSync-stale-settings-clobber.test.tsx` —
renderHook + a deferred `syncClient.pullChanges`; capture `pullChanges` while the
store holds disabled-WebDAV (binds the stale closure), swap the live store to an
enabled-WebDAV object (models the connect mid-pull), resolve the pull, assert the
persisted settings have `webdav.enabled === true`.

**Pattern (recurring):** zustand `settings` destructured from the store hook goes
stale across an `await`; any `saveSettings`/`setSettings` of that closure after
the await clobbers concurrent writes. Always persist
`useSettingsStore.getState().settings` after async work. See the in-place
mutation cousin [[cover-stale-inplace-mutation-memo]] and the WebDAVForm
`persistWebdav` comment that reads live state for the same reason.
