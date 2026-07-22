---
name: opds-catalog-reincarnate-restart-5180
metadata: 
  node_type: memory
  type: project
  originSessionId: 65593e7d-49eb-4c44-a3f9-c126194d8258
---

# #5180 — OPDS server keeps getting deleted after closing the app

MERGED #5191.


**Symptom (reporter omgsian):** add OPDS catalog (autodownload on) → close app → catalog gone on reopen. Cross-platform (iOS + Mac, both cloud-synced), recurring. Contributors couldn't reproduce (no server tombstone in their state). Reopened from closed #5016 (reinstall "fixed" it temporarily — reinstall wipes local state but NOT the server tombstone, so re-adding logged-out worked until the next pull re-applied it).

**Root cause = CRDT remove-wins tombstone that re-add can't revive after a restart.** Same class as fonts/textures [[custom-fonts-reincarnation-4410]]. The catalog list syncs as `opds_catalog` replica rows (NOT via the settings whitelist — `adapters/settings.ts` excludes `opdsCatalogs`). Once any device tombstones the row (`removeCatalog` → `publishReplicaDelete`, a cross-device delete, or the forget-passphrase server wipe of credential rows), every boot pull mirrors it: `replicaPullAndApply.applyRow` sees `!isReplicaRowAlive(row)` → `softDeleteByContentId` → catalog vanishes. A plain upsert can't revive it; only a `reincarnation` token whose fresh `updated_at_ts >= deleted_at_ts` does.

**The OPDS-specific hole:** `customOPDSStore.addCatalog` only minted a token when `existing?.deletedAt` — i.e. only when the tombstoned entry was still in the IN-MEMORY store. But `saveCustomOPDSCatalogs` STRIPS tombstones at persistence (`settings.opdsCatalogs = catalogs.filter((c) => !c.deletedAt)`), unlike fonts/textures which KEEP them (`toSettingsFont` preserves `deletedAt`). So after an app restart there is no local tombstone, `existing` is absent, no token is minted, the re-add loses to the server tombstone, and the next pull deletes it again → "keeps getting deleted".

**Fix (PR for #5180):** one line in `addCatalog` — always carry a token: `input.reincarnation ?? existing?.reincarnation ?? Math.random().toString(36).slice(2)`. The token is inert when the row is alive (no `deleted_at_ts`), so fresh first-ever adds are safe; preserving an existing token avoids churn on re-adds of known entries. This revives ANY hidden server tombstone on the very next add regardless of whether a local tombstone survived — so the user only has to re-add once. Did NOT change the persistence strip (keeping it avoids accumulating dead entries in settings; the always-mint makes the strip irrelevant to correctness). Test: `custom-opds-store.test.ts` "re-adding after a restart (local tombstone stripped) still revives the server row" (delete → save-strips → reload-empty → re-add must reincarnate).

**Ruled out (don't chase these for this issue):**
- Multi-window stale-settings clobber on close (reader window rewrites whole `settings.json` with stale `opdsCatalogs`; `settingsSync.ts mergeSyncedGlobalSettings` doesn't adopt `opdsCatalogs`) — real desktop-only concern but can't explain iOS (single window) and needs an open reader window; not the reporter's simple repro.
- Forget-passphrase wipe (`cryptoSession.forget` → `forgetReplicaKeys`) tombstoning credential-bearing `opds_catalog` rows — plausible tombstone ORIGIN and why maintainer asked "did you enable Credentials sync?", but it's a one-time explicit action; the reincarnation-on-add fix recovers from it regardless of origin.
