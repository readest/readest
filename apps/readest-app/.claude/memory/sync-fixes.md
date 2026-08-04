---
name: sync-fixes
description: "Aggregator index for resolved/stable sync memories (providers, WebDAV, Google Drive, KOSync, koplugin sync, transfer queue)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4af4f927-b772-4650-bb93-26ccd73ba1cb
  modified: 2026-07-28T14:48:08.560Z
---

Moved from MEMORY.md to keep the index small. One line per memory; open the linked file for detail.

- [Cloud Sync provider selection](cloud-sync-provider-selection-plan.md) MERGED #4971-#4976
- [Grimmory native sync](grimmory-native-sync.md) REVERTED
- KOSync: [CFI spine resolution](kosync-cfi-spine-resolution.md); [#4692 connect false-positive](kosync-connect-false-positive-4692.md); #5063 pull dropped
- #5068 sync passphrase unverified trial-decrypt before persist
- [Empty-start CFI sync](empty-start-cfi-sync.md) · [Custom fonts vanish #4410](custom-fonts-reincarnation-4410.md) CRDT remove-wins
- [#5180 OPDS catalog reincarnates](opds-catalog-reincarnate-restart-5180.md) MERGED #5191; remove-wins; addCatalog carries a token
- [#5307 RSS feeds don't sync](rss-feed-books-not-syncing-5307.md) MERGED #5314; feed books fileless; peer gate needs uploadedAt
- koplugin: [note deletion](koplugin-note-deletion-sync.md); [#4666 stats](koplugin-stats-sync.md); [#4751 bulk download](koplugin-bulk-download-4751.md); #4861 dup rows
- [Statusless re-pin #4677](sync-statusless-book-rebump-4677.md) · [pull cursor synced_at #4678](sync-synced-at-cursor-4678.md)
- [koplugin library stale #4934](koplugin-library-stale-synced-cursor-4934.md) synced_at cursor + push watermark
- [#5006 koplugin push crash](koplugin-json-null-function-sentinel-5006.md) MERGED #5186; sanitize null→dkjson.null; dead Turbo looper blocks UI
- [WebDAV sync fixes](webdav-sync-fixes.md) metadata#4756 groups#4942 creds#4810 connect#4780 serverUrl#5141
- WebDAV deletion + upload-after-enable edit-wins LWW + tombstone union
- File sync: [refactor #4784](webdav-filesync-refactor-plan.md) `FileSyncEngine`; [third-party auto-sync #4835](third-party-library-autosync-4835.md)
- [Transfer Queue clear not persisted](transfer-queue-clear-persistence.md) · [Multi-window settings clobber #4580](multiwindow-settings-clobber-4580.md)
- Google Drive: [research](gdrive-sync-provider-research.md); [multi-PR status](gdrive-provider-multipr-status.md); [full walk every sync](gdrive-fullwalk-every-sync-no-source-cursor.md)
- [S3/R2 provider](s3-r2-sync-provider.md) MERGED #5051 · [OneDrive provider](onedrive-sync-provider.md) MERGED #5048
- [Hardcover edition_id #4792](hardcover-progress-edition-id-4792.md)
- [#5444 CORS preflight cache fix](cors-preflight-cache-fix-5444.md) VERIFIED prod: OPTIONS -83%; wrangler OAuth token works for CF GraphQL analytics (1d max range)
