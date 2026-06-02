---
name: custom-fonts-reincarnation-4410
description: Custom fonts/textures disappear when logged into cloud sync after re-import-after-delete; CRDT remove-wins needs a reincarnation token
metadata: 
  node_type: memory
  type: project
  originSessionId: 2b61b392-4d32-4516-84bd-f362bba22378
---

# #4410 — disappearing custom fonts when logged into cloud

**Symptom:** custom fonts vanish a few seconds after opening a book (or ~1 min idle) ONLY when logged into cloud sync; logging out fixes it; a brand-new never-deleted font is fine; problem starts after deleting a font / "Clear Custom Fonts" then re-uploading the same file.

**Root cause — CRDT remove-wins.** The replica sync (`src/libs/crdt.ts`, `src/libs/replicaInterpret.ts`) is remove-wins: once a row has a `deleted_at_ts` tombstone, a plain field upsert does NOT revive it. Only a `reincarnation` token whose effective HLC beats the tombstone revives it. `isReplicaRowAlive(row)` = `!deleted_at_ts || (reincarnation && updated_at_ts >= deleted_at_ts)`. In `mergeReplica` the reincarnation candidate's timestamp is the **row's `updated_at_ts`** (fresh on every upsert), NOT the token's mint time — so preserving an old token still revives, as long as the upsert carries it.

Flow that broke: import→delete writes a server tombstone (`publishReplicaDelete`). Re-upload same file → same `contentId` → `addFont` cleared `deletedAt` locally and called `publishFontUpsert` with `reincarnation = undefined` → server tombstone survives → next pull (boot 5s / periodic / book-open / visibility) sees `isReplicaRowAlive===false` → `softDeleteByContentId` → font disappears.

**Fix (PR for #4410):** in `addFont` (`src/store/customFontStore.ts`) and `addTexture` (`src/store/customTextureStore.ts`), when re-adding an existing entry, mint a reincarnation token (`Math.random().toString(36).slice(2)`, matching OPDS) when `!!contentId && !existing.reincarnation && (existing.deletedAt || existing.contentId === new.contentId)`; otherwise preserve `existing.reincarnation`. Covers both re-import-after-local-delete AND the stale-local race (local still live but another device tombstoned the row). Token is inert without a tombstone, so live re-imports are safe.

**Coverage matrix across collection kinds (all share the remove-wins replica):**
- Dictionary — handles BOTH cases (gold standard): `dictionaryService.ts importDictionaries` via `findTombstonedDictionaryMatches` + `shouldMintReincarnationForLiveReimport` (helpers in `dictionaries/dictionaryDedup.ts`), mints `uuidv4()`.
- OPDS — case 1 only: `customOPDSStore.addCatalog` (`existing?.deletedAt && !input.reincarnation`).
- Fonts / Textures — handled NEITHER → this bug. Now fixed to dictionary-parity.

Whole chain carries the token: returned font → `publishFontUpsert` upsert AND `queueReplicaBinaryUpload` → manifest publish (`replicaBinaryUpload.ts` uses `record.reincarnation`).

Note: `saveCustomFonts`/`saveCustomTextures` persist tombstoned (deletedAt) entries too, so the soft-deleted entry is still in the store at re-import time → the `existing.deletedAt` branch fires. (OPDS strips deleted at save; fonts/textures keep them.)
