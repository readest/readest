---
name: koplugin-local-present-sweep-noop
description: "koplugin lightScan stale-file sweep is a no-op — upsertBook OR-merges local_present so deleted books stay \"on device\" forever; user must delete readest_library.sqlite3"
metadata: 
  node_type: memory
  type: project
  originSessionId: 252d00e8-9934-47c9-82b9-f34fcb539e88
---

Reported via Reddit (2026-07): user deleted everything in `koreader/books`, then Readest Library said "No books to download", tapping a book said file moved/deleted → Rescan (which visibly did nothing), and reinstalling the plugin didn't help.

Root cause (confirmed with live busted repro): `librarystore.lua upsertBook` OR-merges `local_present` (`math.max(existing, new)`, comment "no use case for force-clearing yet"), so `localscanner.lua lightScan` step 1's `upsertBook({local_present = 0})` stale sweep can never clear the flag. Downstream:

- `listCloudOnlyBooks` requires `local_present = 0` → bulk "Download all books" sees zero candidates.
- `librarywidget.handleTap` takes the `local_present == 1` branch → missing-file prompt; `fullSidecarWalk` (Rescan) only ADDS from sidecars, never clears, and finds nothing in an emptied folder.
- State lives in `koreader/settings/readest_library.sqlite3` (DataStorage settings dir), so plugin reinstall doesn't reset it.

User remedy: close KOReader, delete `koreader/settings/readest_library.sqlite3`. Pull cursor lives in the same DB's sync_state → next Library open does a full `since=0` re-pull; auth is stored elsewhere so no re-login.

Fix design (not yet implemented): add a `_force_local_present` sentinel to `upsertBook` mirroring `_force_cloud_present`; use it from the lightScan sweep, and ideally also from `handleTap`'s missing-file branch so the row flips to cloud-only (download prompt) immediately. Failing spec shape is in the repro: upsert cloud+local row, upsert `{local_present=0}`, expect 0.

Same store, related fixes: [[koplugin-library-stale-synced-cursor-4934]], [[koplugin-json-null-function-sentinel-5006]].
