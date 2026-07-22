---
name: webdav-credential-sync-4810
description: "WebDAV credentials weren't synced cross-device; add to settings whitelist + encrypted fields + mergeSettings deep-merge"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a4937d3-05a4-4e1e-b917-d56304b66f2b
---

Issue #4810: WebDAV credentials never synced across devices despite the
"Credentials" sync toggle being ON. WebDAV (`webdav.serverUrl/username/password/rootPath`)
was simply absent from the settings replica whitelist — only kosync/readwise/hardcover
were there.

Fix (`src/services/sync/adapters/settings.ts`):
- Added `webdav.serverUrl`, `webdav.username`, `webdav.password`, `webdav.rootPath`
  to `SETTINGS_WHITELIST`.
- Added `webdav.username`, `webdav.password` to `SETTINGS_ENCRYPTED_FIELDS`.
- Deliberately EXCLUDED per-device bookkeeping: `enabled`, `deviceId`,
  `lastSyncedAt`, sync sub-toggles. Mirrors KOSync, which syncs credentials
  but NOT its `enabled` flag — a fresh device pre-fills the connect form and
  the user clicks Connect (avoids auto-arming sync / rotating deviceId).

**Gotcha (the real trap):** `mergeSettings` in `replicaSettingsSync.ts` does a
top-level shallow merge (`{...current, ...patch}`) plus single-level deep
merges ONLY for explicitly-listed nested groups (globalViewSettings,
globalReadSettings, kosync, readwise, hardcover, dictionarySettings). Adding a
new nested whitelist group WITHOUT a matching deep-merge case there means the
shallow merge REPLACES the whole sub-object with the partial patch, wiping
sibling per-device fields (here: `webdav.enabled`/`deviceId`/sub-toggles would
be clobbered to undefined on every pull). Always add the `if (patch.X)` deep
merge when adding `X.*` paths to `SETTINGS_WHITELIST`.

Encrypted-path plumbing is generic: `ENCRYPTED_PATHS` in replicaSettingsSync.ts
derives from `SETTINGS_ENCRYPTED_FIELDS`, and replicaPublish uses
`adapter.encryptedFields` — so listing the two webdav fields there is enough
to gate them behind the credentials toggle + crypto session.

Also updated the credentials-category description (SyncCategoriesSection.tsx)
to list WebDAV; migrated the i18n key in all 33 locale JSONs manually (NOT via
`pnpm i18n:extract`, which prunes valid keys — see [[i18n-extract-prunes-keys]]).

Related: [[multiwindow-settings-clobber-4580]], [[webdav-metadata-sync-4756]],
[[webdav-connect-nullified-4780]].
