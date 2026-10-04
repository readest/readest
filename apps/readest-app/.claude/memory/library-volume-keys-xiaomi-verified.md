---
name: library-volume-keys-xiaomi-verified
description: "E-ink library volume-key paging (#6456) VERIFIED on Xiaomi 13 2026-10-05; recipe to test library paging on device with a 2-book library via Columns=1 + CDP"
metadata:
  node_type: memory
  type: project
  originSessionId: 9ec065e2-2fbc-47ea-b566-81d57b3dd9ea
  modified: 2026-10-04T16:31:53.850Z
---

Volume-key paging of the e-ink library (`useLibraryPagination`, added #6456) was VERIFIED on the Xiaomi 13 (fuxi) on 2026-10-05 with a 0.12.10 dev build. Each Volume Down pages forward and each Volume Up pages back (scrollTop 0→587→975→587→0, row-snapped). The ringer volume did not change, so the keys were intercepted. With Use Volume Keys off the library did not move (negative control). The Hide Bookshelf Buttons setting (default-on since #6631, MERGED as 8f2fb4c58, UNRELEASED) has no effect on key paging.

Gates: global `isEink` AND global `globalViewSettings.volumeKeysToFlip` (Settings > Behavior > Page Turner > Use Volume Keys), mobile only.

**How to apply (recipe):**
- `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` (release dev builds expose it). Node 24 global `fetch` + `WebSocket` → `Runtime.evaluate`; needs `NO_PROXY='*'`.
- Read saved settings from JS: `__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file',{path:'settings.json',options:{baseDir:13}})` returns bytes; decode with TextDecoder.
- A tiny library can't scroll. Set View menu > Columns to 1 (the − button) so 2 books + the import tile overflow. Restore by tapping + back to the original value, then Auto; the toggles are `libraryColumns` and `libraryAutoColumns`.
- Press keys with `adb shell input keyevent KEYCODE_VOLUME_DOWN`, then read the scroller's scrollTop (the nearest scrollable ancestor of `[data-page-row]`). Read the ringer with `cmd media_session volume --stream 2 --get`.
- The Xiaomi test phone is NOT signed in to Readest, so library changes there don't sync anywhere.

Related: [[reverse-wheel-hide-bookshelf-buttons-6439]]
