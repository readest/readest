---
name: sync-fixes
description: "Aggregator index for resolved/stable sync memories (providers, WebDAV, Google Drive, KOSync, koplugin sync, transfer queue)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4af4f927-b772-4650-bb93-26ccd73ba1cb
  modified: 2026-08-16T09:36:39.438Z
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
- [#5253 OneDrive OAuth trailing slash](onedrive-oauth-callback-slash-5253.md) MERGED #5479; Rust drops unknown TS fields · [OneDrive AADSTS90023 Origin](onedrive-token-origin-aadsts90023.md) MERGED #5604, verified; needs `unsafe-headers` + `Origin: ''`
- [#5465 dictionary prefs vs toggle](dictionary-prefs-settings-replica-category-5465.md) MERGED #5470 · [10k library breaks /sync pull](sync-pull-10k-worker-1102.md) MERGED #5364
- [#5426 BookOrbit integration](bookorbit-integration-5426.md) MERGED #5487
- [#5720 mixed-fleet toast REMOVED](mixed-fleet-toast-removed-5720.md) MERGED #5726; fixed anchor re-warned every launch; user chose removal; ack-cursor design saved if it returns
- #5067 shelf progress never pulled `mergeBookMetadata` subset = what travels
- koplugin: [#4374 cover upload](koplugin-cover-upload.md); #5094 gesture + upload current; [#4954 slow open](koplugin-library-open-mosaic-cache-4954.md)
- [#5666 Push stats now wedged](koplugin-stats-push-chunking-5666.md) MERGED #5670; 500-event chunks w/ per-chunk cursor
- [#5507 auth nil response](koplugin-auth-nil-response-5507.md) MERGED; busted = ONE state · [#5527 conflict re-prompt on refocus](kosync-conflict-reprompt-5527.md) MERGED #5528
- Calibre: [plugin push #4863](calibre-plugin-push-4863.md); `uploaded_at` != blob #5325; status marks #5332; [custom columns #4811](calibre-custom-columns-4811.md)
