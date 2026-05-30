---
name: manage-cache-ios-layout
description: "iOS app container layout and what the Manage Cache feature can/can't clear"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3512356b-a453-42d3-99f6-1ca43d06dd1e
---

Manage Cache feature: `src/utils/cache.ts` (helpers `getCacheEntries`/`getCacheStats`/`clearCacheEntries` over `CacheSource[]`), `src/app/library/components/CacheManagerWindow.tsx` (singleton dialog, `setCacheManagerDialogVisible`, `getCacheSources()` composes the source list), menu item in `SettingsMenu.tsx` Advanced Settings, mounted in `library/page.tsx`.

Scope: **native mobile apps only** (gated on `appService?.isMobileApp`; hidden on desktop + web). Sources cleared: iOS → Cache + Temp + `Documents/Inbox`; Android → Cache + Temp.

On-device analysis (dev build `com.bilingify.readest`, pulled via `xcrun devicectl device copy from --domain-type appDataContainer`):

- The `'Cache'` base = Tauri `appCacheDir()` = **`Library/Caches/com.bilingify.readest`** only — NOT all of `Library/Caches`. On the test device this held ~272 MB: a 249 MB duplicate dictionary (`concise-enhanced.mdx`, canonical copy lives in `App Support/Readest/Dictionaries/<id>/`), ~23 MB duplicate import-staged epubs (canonical in `App Support/Readest/Books/<hash>/`), the `search/` results cache, plus tiny system scratch. All safe to clear — every large item is an orphaned import/download staging duplicate.
- iOS open-in leftovers: **`Documents/Inbox`** (resolved via `documentDir()` + join `Inbox`, scanned/cleared with base `'None'` + absolute paths). Already-imported books linger here. The feature now clears it on iOS. (`tmp/<bundle>-Inbox` also exists but was empty.)
- NOT reachable by the `'Cache'` base: `Library/Caches/WebKit` (~173 MB, WKWebView disk cache — needs native `WKWebsiteDataStore.removeData`) and `tmp/` blob scratch (~59 MB, maps to `'Temp'` base, not currently cleared). These are the bigger "free up space" wins if the feature is ever expanded.
- Never clear `Library/Application Support/com.bilingify.readest/Readest` — the real Books/Dictionaries/Fonts/DB (~1.7 GB).

Root-cause follow-up worth doing: the import pipeline leaves staging copies in the cache root and `Documents/Inbox` instead of deleting them after import.
