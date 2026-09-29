---
name: ios-pan-lock-momentum-6407
description: "#6407 iOS pan lock drifts in scroll mode; WebKit ignores touch-action for a touch that catches a coasting scroller; fix = overflow-x hidden + strip translate; in-app sim did NOT reproduce"
metadata:
  node_type: memory
  type: project
  originSessionId: 406db9d4-0068-4151-ba57-3b92a523213a
  modified: 2026-09-29T16:26:36.622Z
---

Issue #6407 (2026-09-30): iOS 27, fixed-layout (PDF) vertical scroll mode, "Lock Horizontal Panning" holds
for one swipe but the page drifts sideways once the reader flicks repeatedly. Follow-up to
[[pdf-lock-horizontal-pan-5976]].

**Mechanism (reproduced in iOS 26.3 sim Safari with a test page, NOT inside the Readest app):**
`touch-action: pan-y` is honored for a swipe that starts from rest, but a swipe that starts while the scroller
is still coasting is handed straight to the native UIScrollView, which ignores touch-action (scrollLeft 150 ->
-69..294). A non-passive touchstart listener does not help; stopping momentum at touchstart does not help.
- `overflow-x: hidden` alone is WORSE: WebKit gives the UIScrollView no x range, so a vertical fling animates
  scrollLeft back to 0.
- JS pin (reset scrollLeft on scroll) holds x and tracks the finger, but every write KILLS fling momentum.

**Fix = foliate-js #107 MERGED (1f77f38, pinned in 480718511) + readest #6475 MERGED (211c206df) UNRELEASED; worktree + branches removed:**
in vertical scroll flow the lock sets host `overflow-x: hidden`, scrollLeft 0, and carries the panned offset as
`translate: var(--locked-pan-x)` on `.scroll-container` (`#lockedPanX`, `#syncScrollPanLock`), clamped on
re-render, fed into the pinch origin and pinch-anchor restore. Gate on `#scrollContainer` (lock can be set
before open()). Browser test in fixed-layout-pan-lock.browser.test.ts.

**Sim verification:** fixed build holds x (offset -100px, scrollLeft 0) through momentum flicks and keeps momentum.
BUT the old build, and the old CSS injected into the fixed build, ALSO held inside the app on the sim, so the
in-app drift was never reproduced (only sim Safari). The report is from iOS 27, which no local sim runtime covers.
Worktree iOS build needs the ignored gen/apple files rsynced from main + a swift-rs ModuleCache clear
([[swift-rs-module-cache-shared-target-worktrees]]); the build rewrites project.pbxproj + ShareExtension/Info.plist.
