---
name: webdav-filesync-refactor-plan
description: Planned refactor extracting a provider-agnostic file-sync engine (LWW/CRDT) so WebDAV/Drive/Dropbox/FTP/SFTP reuse it
metadata: 
  node_type: memory
  type: project
  originSessionId: a9e2f86a-c773-4f5d-95d7-4451d332de5d
---

**STATUS: MERGED as PR #4784** (squash commit `99b9adfe8` on `origin/main`). Branch `refactor/file-sync-engine` (worktree `/Users/chrox/dev/readest-refactor-file-sync-engine`), 11 commits off `origin/main` (cecb1c53). All gates green: `pnpm test` 6244 pass / 9 skip / 0 fail, `pnpm lint` + `pnpm format:check` clean. NOT yet pushed / PR'd (awaiting user confirm). Decisions from AskUserQuestion: shared LocalStore bridge + single PR.**

**As-built structure** (matches the proposal below):
- `src/services/sync/file/`: `provider.ts` (`FileSyncProvider`/`FileEntry`/`FileHead`/`FileSyncError{code:AUTH_FAILED|NOT_FOUND|NETWORK|CONFLICT|UNKNOWN,status?}`), `layout.ts` (de-WebDAV'd `SYNC_*` consts; paths pure), `wire.ts` (`RemoteBookConfig`/`RemoteLibraryIndex` + build/parse; `writerVersion:'readest-webdav-1'` FROZEN), `merge.ts` (`mergeNotes`/`mergeBookConfig`/`mergeBookMetadata`/`isRemoteBookMetadataNewer` + law tests), `localStore.ts` (`LocalStore` iface), `appLocalStore.ts` (`createAppLocalStore({appService,settings,envConfig})` — the shared bridge that killed the duplicated buffered+streaming loaders), `engine.ts` (`FileSyncEngine(provider,store)` class + free `deleteRemoteBookDir(provider,hash)`), `index.ts`.
- `src/services/sync/providers/webdav/`: `client.ts` (moved WebDAVClient), `WebDAVProvider.ts` (`createWebDAVProvider(settings)`; maps WebDAVRequestError→FileSyncError; Tauri-only `uploadStream`/`downloadStream` own URL+auth via tauriUpload/Download), `connectSettings.ts` (moved).
- Consumers: `useWebDAVSync.ts` + `WebDAVForm.tsx` build provider+store+engine (`engine.pushBookConfig/pullBookConfig/pushBookFile/pushBookCover` / `engine.syncLibrary(books,{strategy,syncBooks,deviceId,onProgress})`); `WebDAVBrowsePane.tsx` builds a provider for `deleteRemoteBookDir(provider,hash)`. `useWebDAVSync`'s `{pushNow,pullNow}` external API unchanged.
- Tests: new `sync/file/{layout,wire,merge,provider-conformance,engine-metadata-sync}.test.ts` (engine test = retargeted #4756 gate via fake provider+store); `webdav-{encode-path,connect-settings,delete}.test.ts` repointed; old `webdav-metadata-sync.test.ts` deleted; old `src/services/webdav/` removed entirely.
- Behaviour preserved: syncLibrary ported line-for-line (strategy gating, hash-dir discovery, HEAD short-circuits, streaming heap-pressure path, #4756 metadata LWW + config pull-merge-push). Callback guards that were `if(options.x)` became unconditional because the store always supplies them (form provided all; equivalent).
- Plan doc: `.agents/plans/2026-06-25-file-sync-engine-refactor.md`.

**Post-implementation `/autoplan` review (Codex + Claude eng subagent + my pass), 3 follow-up commits added:**
- `fix(sync)` **data-loss (Codex HIGH, pre-existing, not a refactor regression)**: `WebDAVForm.handleSyncNow` loaded the library locally but never `setLibrary`'d, so engine `addBookToLibrary`/`updateBookMetadata` merged against an EMPTY zustand store and persisted a downloaded book / metadata update as the *entire* library, wiping `library.json`. Trigger: Sync now while `libraryLoaded===false` (launched into reader/settings) + a remote download/metadata-newer. Fix = `setLibrary(currentLibrary)` in handleSyncNow + load-if-unloaded guard in `appLocalStore.addBookToLibrary`/`updateBookMetadata` (mirrors the existing `useLibraryStore.updateBooks` hardening). `setLibrary` sets `libraryLoaded:true`. New `appLocalStore.test.ts` regression test.
- `refactor(sync)` **list() error contract**: `client.ts` `listDirectory` threw a plain `Error` (and let raw fetch rejects escape), so `WebDAVProvider.mapError` flattened all `list()` failures to `FileSyncError(UNKNOWN)`. Now throws the same `WebDAVRequestError` taxonomy as the file-level helpers (AUTH_FAILED/NOT_FOUND/NETWORK). Harmless before (both engine `list()` sites only `console.warn`) but violated the `provider.ts` contract. Added `list()` conformance cases.
- `test(sync)` **engine path coverage**: the metadata gate only hit buffered metadata+config paths. Added `engine-sync-paths.test.ts` for streaming `uploadStream` (+HEAD short-circuit +one-shot retry), remote discovery→`downloadStream`→addBook, and `receive` strategy (no writes).
- Review verdict: refactor itself is a faithful, clean port (no regressions in the port). Findings were 1 pre-existing data-loss bug + 1 contract gap the refactor introduced + test gaps. All green: `pnpm test` 6254 pass, lint, format:check. Still NOT pushed/PR'd.

**Follow-up feature commit `feat(sync): incremental WebDAV Sync now + bounded concurrency`:**
- **Incremental by default**: `engine.syncLibrary` was a full walk of all books each run. Now diffs local vs remote `library.json` per hash: push only `local.book.updatedAt > remoteIndex.book.updatedAt` (or local-only); skip equal; remote-newer books pull config in the reconcile pass (so peer progress still propagates without re-walking). Key fact: `book.updatedAt` bumps on EVERY progress/notes/metadata save (`bookDataStore.saveConfig` rewrites the book w/ `updatedAt: now` + re-persists library.json), so the index is a reliable per-book change cursor. Boundary: a peer's `config.json` pushed by their reader-hook but not yet reflected in the index (their index entry stale) is missed until Full Sync or book-open — the reader hook doesn't rewrite library.json per page-turn. `send` mode (no index pull) → push all.
- **Full Sync toggle** (`settings.webdav.fullSync`, default off) in WebDAVForm → re-checks every book (the old full behavior). New `SettingsSwitchRow` "Full Sync".
- **Bounded concurrency** default 4: reconcile/download/push phases run over a `runPool(items, limit, worker)` (shared-cursor worker loops) instead of sequential. `concurrency` engine option.
- Tests: incremental skip/push/pull/fullSync + concurrency cap (maxInFlight===limit) in `engine-sync-paths.test.ts`; #4756 config-merge tests retargeted to local-newer (the push case where merge-before-push matters). `engine.ts` runPool + `isLocalNewer`.
- **Live Chrome verify** (web dev build vs user's real 192.168.2.3:6065 WebDAV, 675 books): full sync crawled 115→222→301; incremental Sync now finished with NO progress crawl (Last synced 11:15→15:26:55, instant); Full Sync toggle renders; browse pane lists /Readest (books/ + library.json 802KB); zero console errors. All gates green: `pnpm test` 6261 pass, lint, format:check.
- Remaining/future (unchanged from below): per-field LWW on config scalars; content-hash cover (coverHash #4544) for WebDAV; an actual 2nd provider; `webdavSyncStore`/`webdavBrowseUtils` stay WebDAV-named. Manual runtime check against a real WebDAV server/device is the only thing the automated gates can't cover.

---

ORIGINAL PLAN (design proposed, since implemented as above). Follows merged [[webdav-metadata-sync-4756]].

**Goal**: extract a provider-agnostic file-based sync engine from the WebDAV-specific transport so future providers (Google Drive / Dropbox / FTP / SFTP) only implement a small file-ops interface; all merge + orchestration lives in one base service. Refactor WebDAV as the FIRST provider.

**User decisions (locked via AskUserQuestion)**:
- Scope = **Extraction + improve semantics** (make LWW/CRDT first-class; user phrase "autoplan" = drive it forward).
- Streaming lives **inside the provider interface** (provider owns URL+auth; the settings form stops knowing WebDAV URLs).
- **Fresh separate branch / PR.** Now that #4776 is merged, branch the refactor off **updated `origin/main`** (no longer off the fix branch — main already has the fixes). Use `pnpm worktree:new`.

**Current seam (already fairly clean)**: `src/services/webdav/WebDAVSync.ts` (~1140 LOC) = orchestration + merge + wire formats (provider-agnostic). `WebDAVClient.ts` (~593) = transport. `WebDAVPaths.ts` = layout (pure fns of rootPath; only `normalizeRootPath`/URL-building are WebDAV-specific). Engine only calls 8 client primitives: getFile/getFileBinary/putFile/putFileBinary/headFile/listDirectory/ensureDirectory/deleteDirectory (+ buildRequestUrl/buildBasicAuthHeader for streaming). Reader hook `app/reader/hooks/useWebDAVSync.ts` (~604) calls pull/pushBookConfig directly. `WebDAVForm.tsx` wires app callbacks + streaming (tauriUpload/Download).

**Proposed structure**:
- `src/services/sync/file/`: `provider.ts` (FileSyncProvider iface, FileEntry, FileSyncError{code:AUTH_FAILED|NOT_FOUND|NETWORK|CONFLICT|UNKNOWN,status?}), `layout.ts` (de-WebDAV'd Readest/books/<hash> paths), `wire.ts` (RemoteBookConfig/RemoteLibraryIndex), `merge.ts` (pure LWW/CRDT), `engine.ts` (FileSyncEngine class over a provider), `index.ts`.
- `src/services/sync/providers/webdav/`: WebDAVProvider (implements iface incl. uploadStream/downloadStream), moved WebDAVClient, webdav-only paths, connectSettings.

**FileSyncProvider** (~10 methods): `rootPath`; readText/readBinary/head/list (null on 404); writeText/writeBinary/ensureDir(paths[])/deleteDir; optional uploadStream(remotePath,localPath)/downloadStream(remotePath,localPath)→bool (provider owns URL+auth, falls back to buffered writeBinary/readBinary when absent). **App callbacks stay engine options** (local I/O via appService/stores): loadConfig, saveBookConfig, loadBookCover/saveBookCover, addBookToLibrary, updateBookMetadata, plus new resolveLocalBookPath(book) for streaming.

**merge.ts declarative policy** (the "improve semantics" payload — each pure + own tests): `mergeNotes` = CRDT (union by id, per-note updatedAt, deletedAt tombstones); `mergeBookConfig` = LWW scalars (config.updatedAt) + notes via mergeNotes; `mergeLibraryIndex` = CRDT membership (union by hash + tombstones) + per-book metadata LWW (book.updatedAt); `mergeBookMetadata` = LWW (book.updatedAt). Route BOTH reader hook and library "Sync now" through the SAME pull→merge→push so read-merge-write is structural, not a special case (the #4756 commit-2 fix).

**Out of scope (note as future)**: per-field LWW on config scalars (needs wire-format field timestamps), content-hash cover detection (coverHash #4544) for WebDAV, an actual 2nd provider impl. `WebDAVBrowsePane` keeps using the client directly (WebDAV-specific browse UI).

**Behavior-preservation testing**: existing `webdav-*` tests stay green (now via WebDAVProvider); retarget `webdav-metadata-sync.test.ts` to the engine; ADD pure `merge.test.ts` (commutativity/idempotence/tombstone laws) + a provider-conformance suite reusable by future providers.

Stale worktree `/Users/chrox/dev/readest-fix-webdav-sync-stale-4756` (branch merged) can be removed via `pnpm worktree:rm`.
