---
name: proofread-per-book-crdt-sync
description: "Per-book/selection proofread rules now CRDT-merge by id on config pull (was dropped); tombstone-on-delete"
metadata:
  node_type: memory
  type: project
---

MERGED via PR #4781 (2026-06-25, squash commit 79ae8a48).

Per-book + selection-scope proofread rules now actually sync across devices via an
item-level CRDT merge (keyed by rule `id`), mirroring how booknotes merge. Before
this, `useProgressSync.applyRemoteProgress` pulled the full synced book config but
only applied `location`/`xpointer`, dropping `viewSettings.proofreadRules` (and
everything else). Library/global-scope rules sync separately via the settings
replica (`adapters/settings.ts` whitelist, whole-field LWW) — see [[proofread-enhancements-4700]].

**Design (per maintainer):** no new DB table — the rules keep riding the existing
book-config blob; the pull side just stops discarding them and merges by id instead.

What changed:
- `ProofreadRule` (`types/book.ts`) gained `updatedAt?: number` (LWW key) and
  `deletedAt?: number | null` (tombstone). No `createdAt` (the existing `order` covers ordering).
- New pure `mergeProofreadRules(local, remote)` in `src/utils/proofread.ts` — by id,
  LWW on updatedAt/deletedAt, identical semantics to `mergeNotes` in WebDAVSync.ts.
- `proofreadStore.ts`: stamps `updatedAt` on add/update/toggle/reorder; **`removeBookRule`
  now TOMBSTONES (sets deletedAt) instead of splicing** so the per-id merge can't
  resurrect a deleted rule from the peer's live copy. `removeGlobalRule` STAYS a
  hard-splice — library deletion already propagates via the settings replica's
  whole-field LWW (shrinking the array wins), so a tombstone there would just leave
  dead entries. Getters (`getBookRules`/`getGlobalRules`/`getMergedRules`) and the
  book-scope dedup filter out `deletedAt`.
- `transformers/proofread.ts`: render filter gained `!r.deletedAt`.
- `ProofreadRules.tsx` `useReplacementRules`: filters `deletedAt` so tombstoned rules
  don't show in the manager list.
- `useProgressSync.applyRemoteProgress`: merges `syncedConfig.viewSettings?.proofreadRules`
  (filtered to scope !== 'library') into the open book's rules, `setViewSettings` +
  `saveConfig`, and `recreateViewer` ONLY when the merged array actually differs (guards
  a reflow on no-op pulls).

Convergence gotcha (why the push re-uploads the union): `bookDataStore.saveConfig` only
merges `{updatedAt}` into the in-memory config — it does NOT write the passed viewSettings
into `booksData`. The thing that syncs merged viewSettings into `booksData.config` (so the
next `pushConfig`→`getConfig` serializes the union) is `readerStore.setViewSettings`, but
only when the viewState `isPrimary`. So call order must be setViewSettings → saveConfig
(same as `proofreadStore.updateBookViewSettings`).

**Stable id (`ensureRuleId` in utils/proofread.ts):** the merge keys on `id`, so id-less
rules (legacy / hand-edited / foreign peer) would ALL collide on the Map's `undefined`
slot — distinct rules clobber each other (silent loss, NOT duplication). `ensureRuleId`
backfills a missing id with a content hash `ph-${md5(scope|isRegex|pattern)}` (selection
scope also folds in sectionHref+cfi since it's per-instance), applied on both sides inside
`mergeProofreadRules`. `createProofreadRule` now seeds book/library ids the same way
(`id = scope==='selection' ? uniqueId() : ''` then `ensureRuleId`) so the SAME rule made
independently on two devices dedupes on sync instead of duplicating; selection rules keep
`uniqueId` (per-instance). Identity excludes replacement/case/wholeWord to match the
in-store dedup (pattern+isRegex). Ids are assigned ONCE and frozen — edits never re-key
(updates omit `id`). Limitation: rules already created with the old random `uniqueId` keep
those ids, so pre-existing identical rules across devices are NOT retroactively merged.

WebDAV does NOT carry proofread rules: its wire envelope strips viewSettings (`buildRemotePayload`),
so this only fixes the native cloud sync path. WebDAV would need un-stripping + the same merge.
