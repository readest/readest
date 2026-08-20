---
name: bookmark-pull-fixed-layout-5142
description: "#5142/#5757 bookmark pull gesture: gate on vertical panning (not isFixedLayout) and yield to mid-gesture text selection; committed abe180cbd, Xiaomi-verified via CDP synthetic touch"
metadata:
  node_type: memory
  type: project
---

Committed `abe180cbd` on dev (2026-08-20, authored by the prior session, left uncommitted pending device verify). `canPullBookmark` swaps `isFixedLayout` for `verticalPanning` = `hasVerticalPanning(view, viewSettings)` (pre-paginated AND (zoom>100 OR zoomMode!=='fit-page') AND `view.isOverflowY()`), so fit-page PDF/CBZ pages get the pull-to-bookmark gesture (#5142) while zoomed/fit-width pages keep vertical drags for panning. `onTouchMove` also yields permanently pre-activation when `doc.getSelection()` is non-collapsed (OS long-press selection landing after touchstart, #5757) or `view.renderer.scrollLocked` (instant-highlight quick action).

Xiaomi-verified 2026-08-20 (all via CDP `Input.dispatchTouchEvent`, no finger): reflowable band+hint+toggle both directions; mid-gesture selection suppresses the pull; fixed-layout fit-page engages band + toggles bookmark; pinch-zoomed page (overflowY) never engages at 60px or 140px; gate re-engages after pinch back to fit — it is computed per-gesture, not cached.

**Why:** the eligibility gate reads live view geometry (`isOverflowY()`); tests that mock `getView` must mirror `{ book: { rendition: { layout } }, isOverflowY(), renderer: { scrollLocked } }` — see the BookmarkPullDown test store mock.

Related: [[pr-5179-layered-turn-toolbar-sync]], [[issue-4584-tap-death-investigation]], [[feedback-always-verify-on-xiaomi]]
