---
name: overscroll-library-not-reader-5148
description: "MERGED #5867 (bc4b253b6, 2026-08-25) fixes #5148: #5148 'no overscrolling on mobile' (iOS 18) is the LIBRARY bookshelf grid, not the reader; PR #5867's -webkit-overflow-scrolling:touch on foliate-view::part(container) is a dead property on iOS 13+ and unsupported in Blink -> requested changes 2026-08-25; Xiaomi VERIFIED no-op (byte-identical A/B frames)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 36eb4fed-6918-4d8b-8e00-61b0c82f60c3
  modified: 2026-08-25T11:04:10.752Z
---

Issue #5148 (dastarruer, iOS 18.7.8, Readest 0.11.18, filed 2026-07-16): the
bug video is the Library grid (`Bookshelf` Virtuoso scroller, "Search in 88
books...", trailing "+" tile) hitting top/bottom with no rubber-band; the
"expected" video is Apple Books' Home tab. The no-bounce is deliberate:
`usePullToRefresh` sets `el.style.overscrollBehavior = 'none'` on that
scroller (`src/hooks/usePullToRefresh.ts`) so the JS pull-to-refresh damping
shows on iOS, plus `:root { overscroll-behavior: none }` in `globals.css`.

PR #5867 (jadhavgaurav, 2026-08-25) added
`foliate-view::part(container) { -webkit-overflow-scrolling: touch }` plus a
source-regex test on globals.css. Reviewed 2026-08-25: wrong screen AND a
no-op property. Evidence gathered from WebKit `main`:
- `RenderLayerScrollableArea::canUseCompositedScrolling()` returns early on
  `asyncOverflowScrollingEnabled()` (default true on Cocoa since iOS 13) and
  never reads the property; only other consumer is `StyleAdjuster` forcing a
  stacking context (container already has `translateZ(0)` in scrolled mode).
- Property gated behind internal `LegacyOverflowScrollingTouchEnabled`
  setting (`UnifiedWebPreferences.yaml`).
- Blink `css_properties.json5` has no `-webkit-overflow-scrolling` at all.
CodeRabbit marked "Linked Issues check: passed" on it; do not trust that gate
for behavior claims.

**Xiaomi 13 verification (2026-08-25, Android 16, WebView Chrome 153.0.7985.0,
CDP on the running 0.12.1 dev build):** `CSS.supports('-webkit-overflow-scrolling',
'touch')` is false; `cssText='-webkit-overflow-scrolling: touch; color: red'`
reads back `color: red;`; the PR rule injected live parses as
`foliate-view::part(container) { }` (0 declarations). Reader scrolled mode
(shift+J), finger held 220px past the top (book start) and bottom (book end):
mid-gesture `Page.captureScreenshot` frames with vs without the rule are
byte-identical (md5 689b04.. / 3f853a..); no stretch either way, content flush
at the edge. Library edges: bottom flat (inline overscroll-behavior none), top
shows the JS pull-to-refresh arrow at 80px. Recipe: `svc power stayon usb` +
phone UNLOCKED (secure keyguard freezes the process and starves
captureScreenshot); `Input.dispatchTouchEvent` drag + probe + shot while held
(scratchpad `drive.mjs drag`). `goToFraction(0/1)` MOVES the user's reading
position, restore it afterwards.

**MERGED as squash `bc4b253b6` (#5867, 2026-08-25); worktrees, local branches, fork remote and dev duplicates cleared 2026-08-26.** History: chrox verified iOS + Android OK, then
had the fix pushed onto the contributor's branch (fork `jadhavgaurav`, HTTPS
push works with maintainerCanModify): PR head is now `15e07ff14` = PR's
21845609b + cleanup `99a2067ec` (drops the no-op rule + source test) + the fix
`efee2a49d` + touchcancel snap-back `15e07ff14` (CodeRabbit r3854973103: a
cancelled touch left wrappers translated + listeners attached; pre-existing
for the top pull too); title/body rewritten. Local `dev` carries the same
changes as `7669892d3` + `5a14f85da` (duplicate once #5867 merges; drop or rebase dev).
Branch `fix/library-overscroll-5148` (2a4f69bc1) still exists locally;
`readest-pr-5867` worktree still exists. Review comment draft never posted
(PR was taken over instead). Fix details: `usePullToRefresh` no longer pins `overscroll-behavior: none`; on iOS
(`getOSPlatform()==='ios'`) the native bounce carries the content and the hook
only drives the spinner + trigger, elsewhere the JS translate stays;
`globals.css` adds `foliate-view::part(container) { overscroll-behavior: none }`
(reader must never bounce). Gates green (823 files / 10114 tests, lint, format).
Xiaomi VERIFIED on the built APK (md5 5943bae2..): bookshelf scroller computes
`auto` with no inline override, pull-to-refresh still translates + shows the
spinner on Android, reader container computes `none` in paginated AND scrolled
mode. Android can't render overscroll on a nested scroller at all (real swipes,
real screencaps), so the visible bounce is iOS-only and UNVERIFIED on iOS (no
device); the iOS spinner overlays the first row during loading instead of the
old 80px hold. GOTCHA: `goToFraction(1)` flips `readingStatus` to `finished`
(readerStore auto-finish at 100%); undo via long-press -> Status -> Clear
Status. Fresh-launch pull-to-refresh can miss the first drag (pre-existing
`useEffect(..., [ref.current])` attach race), retry after a re-render.

**Android reality (2026-08-25, Xiaomi 13 / WebView Chrome 153):** the WebView
draws NO overscroll for the app, ever: `OverScrollGlow.pullGlow` only glows
vertically when the document itself scrolls (`maxY > 0`) or the view is
`OVER_SCROLL_ALWAYS`; Readest's document never scrolls, and even
`webView.overScrollMode = OVER_SCROLL_ALWAYS` in `MainActivity.onWebViewCreate`
plus a scrollable root drew nothing (real swipes, screenrecord), while Chrome
on the same phone stretches fine. Reverted the Kotlin change. Shipped instead:
JS damped rubber-band on the bookshelf at BOTH edges on non-iOS (bottom edge
new; top edge = existing pull-to-refresh), single stiff curve MAX 96 / k 0.35
("too loose" feedback on the old Android 140/0.5), snap-back
`transform 0.25s cubic-bezier(0.2,0.8,0.2,1)`; per-move "still at bottom"
re-check because Virtuoso's scrollHeight is short right after a programmatic
jump. Build 5 (md5 97eeec4e..) VERIFIED on the Xiaomi: bottom -49px during a
real swipe then 0, mid-list drags scroll, top pull 26.9px + spinner.

**Why:** a plausible-sounding CSS one-liner with green CI and a config-mirror
test looked mergeable; only watching the issue's video and reading WebKit
source showed it fixes nothing. Readest ships iOS >= 15.0 / Android minSdk 26,
so any `-webkit-overflow-scrolling` advice is pre-2019 folklore here.

**How to apply:**
- PRODUCT RULE from chrox (2026-08-25, stated while reviewing #5867): overscroll
  / rubber-band is wanted on the Library page and the bookshelf, and NEVER on
  the foliate view (reader). Any "add overscroll to the reader" PR is wrong by
  design regardless of mechanism; the #5148 fix must target the bookshelf
  scroller and make `usePullToRefresh` coexist with native bounce.
- For "no bounce / overscroll" reports, first identify the screen from the
  attachment (`curl -L` the user-attachments URL, `ffmpeg -vf fps=2,tile`
  contact sheet, then Read the PNG); library vs reader have different,
  intentional `overscroll-behavior: none` owners.
- A real #5148 fix is a design call: restoring bounce at the Library top
  conflicts with pull-to-refresh; the bottom edge has no such constraint.
  Needs an iOS device/simulator before/after recording, CI cannot see it.
- Source-text assertions on stylesheets are [[feedback-no-config-mirror-tests]].
- Unverified: whether the reader's scrolled-mode `#container` bounces on iOS
  at all; if it does not, the cause is WebKit nested-scroll chaining into the
  `overscroll-behavior: none` root, not the missing legacy property.
