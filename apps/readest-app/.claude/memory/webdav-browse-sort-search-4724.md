---
name: webdav-browse-sort-search-4724
description: "WebDAV browser sort + search feature (#4724, PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0b4c38bb-34ca-4446-a77a-cd967f88b40e
---

Sort + search for the WebDAV browse pane (Settings > Integrations > WebDAV), issue #4724. MERGED PR #4786 (merge commit `13e0fb814`).

NOTE: rebased onto the #4784 provider refactor late in the work, which MOVED the WebDAV client — paths below reflect the merged (post-#4784) layout, not the original branch.

**Where the pieces live:**
- `services/sync/providers/webdav/client.ts` (was `services/webdav/WebDAVClient.ts`, moved by #4784) — PROPFIND body now requests `<D:creationdate/>`; `WebDAVEntry` gained optional `created`. The whole folder is fetched in one `PROPFIND Depth:1` (no pagination) so sort/filter are pure client-side.
- `components/settings/integrations/webdavBrowseUtils.ts` — pure, unit-tested `sortWebDAVEntries(entries, sortBy, ascending, getName?)` and `filterWebDAVEntries(entries, query, getName?)`.
- `types/settings.ts` — `WebDAVBrowseSortByType = 'name'|'modified'|'created'|'size'`; persisted `WebDAVSettings.browseSortBy` + `browseSortAscending` (both optional; absent => name/ascending = legacy order, no migration).
- `WebDAVBrowsePane.tsx` — controls row (filter box + sort select + ↑/↓ toggle), normal-mode only (hidden in cleanup mode). Persists sort via new optional `onUpdateSettings` prop, wired in `WebDAVForm` to its existing `persistWebdav`.

**Decisions worth remembering:**
- Directories always group first; within a group, sort by field. Entries missing the field (undated / sizeless dirs) sink to the bottom in BOTH directions; stable tiebreak by display name.
- `getName` resolver maps a per-hash book dir to its local library title, so sort "by name" and the filter both operate on the visible title, not the hash.
- Search is transient (reset on folder navigation/refresh); only the sort preference persists.
- Row shows the active sort key's date: created vs modified, so the order is legible.

**Gotchas:**
- Two consecutive refactors landed under this feature: #4774 removed `SyncHistoryPanel`/`syncLog`; then #4784 (provider-agnostic FileSyncEngine) moved `WebDAVClient.ts` → `services/sync/providers/webdav/client.ts` and swapped the pane to `createWebDAVProvider` + `deleteRemoteBookDir(provider, hash)` + `FileSyncError` + `SYNC_BOOKS_DIR`. The rebase auto-carried my `creationdate` change into the moved client via git rename detection; only the pane import block + locale tails conflicted. Re-read post-refactor files before editing.
- Not every WebDAV server returns `<creationdate>`. The home test server at `192.168.2.3:6065` returns `getlastmodified` for all entries but NO `creationdate` (PROPFIND-confirmed 0/675), so "Date created" degrades gracefully to a dateless stable name order. Verified on a physical Xiaomi via `pnpm dev-android` + adb/CDP.
- i18n: 32 locales translated for the 6 new keys; `bo` (Tibetan) left to English fallback. The i18n scanner also surfaced ~20 unrelated pre-existing untranslated keys/locale from other features — deliberately reverted and NOT bundled into this PR (scope).

Related: [[koplugin-bulk-download-4751]], [[opds-groups-carousel-4750]].
