---
name: scrolled-cover-no-relocate-progress-sync
description: "First open in scrolled mode on an image-only (SVG) cover never emits a relocate, so no progress is recorded and the cloud pull never starts; fix = collapsed-range fallback in foliate paginator #getVisibleRange (scrolled branch)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5f01dea0-ac7c-4ef2-8c5c-58a60be6cc8b
  modified: 2026-09-07T18:07:28.954Z
---

Reported by chrox 2026-09-08 (no issue number): a book opened for the first time on a device in scrolled mode "cannot sync progress". Repro book: Holy Bible Recovery Version, hash 86d1b704a563b035e79bc73b40aa4841 on the web dev server (port 3001).

**Root cause (foliate-js `paginator.js`, `#getVisibleRange`, scrolled branch):** the scrolled branch skips every view whose visible range is collapsed (`if (!range || range.collapsed) continue`, added for readest#4436 to prefer the view covering the viewport centre). An SVG-only cover (and the img-only page after it) yields no accepted node in the tree walk because the scrolled rect mapper subtracts the page margin, so the only in-view elements straddle the viewport and the range collapses onto `<body>`. With no other loaded view overlapping the viewport the method returns `undefined`, `#afterScroll` bails before dispatching, and NO `relocate` ever fires on open. Readest's `useProgressSync` gates the initial cloud pull on `progress`, which only exists after a relocate, and the auto-push needs `progress.location`, so neither pull nor push happens until the user scrolls into text. Paginated mode never had this: its branch returns the collapsed range and relocates on `epubcfi(/6/2!/4)`.

**Fix:** keep the collapsed range (preferring the centre view) as a last resort, `return fallback ?? collapsed`. Regression browser test: `src/__tests__/document/paginator-scrolled-cover-relocate.browser.test.ts` (synthetic book, oversized `<svg>` cover). Complement in readest `useProgressSync.ts` (chrox's own diff): apply the remote CFI when the local config has no location at all (`remoteIsAhead = !configCFI || compare < 0`), covered by the "no location yet" case in `src/__tests__/hooks/useProgressSync.test.tsx`; this also fixes the manual Sync button path before any relocate.

**Status 2026-09-08:** PRs opened. foliate: readest/foliate-js#93 (branch `fix/scrolled-collapsed-visible-range`, commit 6eb3bc1); readest: `chrox:fix/scrolled-cover-relocate-progress-sync` pinning that commit. foliate PRs are SQUASH-merged, so the readest submodule pin MUST be re-pointed at the merged main commit before the readest PR merges, or the pin orphans. Live-verified in Chrome with the local config's location/xpointer/progress deleted from IndexedDB (`AppFileSystem` > `files` > `Readest/Books/<hash>/config.json`) and the serwist SW unregistered: cover relocate at 3.6s, pull, jump to the remote position at 5.6s. NOTE: a tab that loads with NO dev server on 3001 is served by the serwist cache (old code) and looks alive.

**Side effects of the probe:** navigating the live reader with `renderer.goTo` auto-pushes within 3s (`SYNC_PROGRESS_INTERVAL_SEC`) and OVERWRITES the cloud position; I restored chrox's Ephesians 3:11-19 position afterwards. Pre-existing quirk noticed, NOT fixed: the paginator swallows the first debounced scroll after a navigation (`#justAnchored`), so the first scroll gesture after open never relocates.

See also [[chrome-mcp-hidden-tab-no-raf]] for why the first repro attempt was confounded.
