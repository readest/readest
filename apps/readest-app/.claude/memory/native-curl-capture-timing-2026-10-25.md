---
name: native-curl-capture-timing-2026-10-25
description: Measured Android native-curl page capture cost on Xiaomi 13 (120 Hz) for the overlapping-sheets idea; step-through capture ~45 ms/page vs 83 ms; burst of taps ~360 ms/turn serial
metadata:
  node_type: memory
  type: project
  originSessionId: 266c36d9-d440-481b-8ed1-da6244736d40
  modified: 2026-10-28T16:35:56.700Z
---

2026-10-25, worktree `readest-exp-page-capture-timing` (branch exp/page-capture-timing, not pushed): probes on `globalThis.__curlProbe` (NativePageTurn), `paginator.previewStrip(count, capture, rafs)`, Kotlin capture returns phase times + 48x48 pixel checksum. Driven over CDP (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, Runtime.evaluate awaitPromise).

Xiaomi 13 (368b0948), Alice ch.11, medians:
- Today's previewPage neighbour capture: 83 ms (scroll+2 rAF 17, native capture 48 = visual-state wait 22 + PixelCopy 10 + GL upload 12, scroll back 15). IPC round trip 8 ms.
- Step-through strip (no restore between pages): ~43-53 ms/page; 5 pages ~230-270 ms incl. one restore. 0, 1 or 2 rAF waits give identical checksums to a 300 ms-settled reference: native `presented()` already waits, the JS double rAF is redundant.
- Today's queue, 5 taps fired at once: one turn per ~340-360 ms; visible settle only ~155 ms, rest is per-turn capture/cover/preview/finish overhead. 5th tap returned false (not investigated).

Round 2 (same day, `allowActive` capture flag + animate frame stats):
- Capture during a committed turn's animation works: 20/20 pages ready, 43-86 ms (median ~57), done 54-102 ms into a ~150-190 ms settle. Cost: worst animation frame 19 ms -> 22-32 ms.
- Baseline curl draws only ~7 frames per ~150 ms settle (~19 ms/frame) on the 120 Hz screen: each pose waits for acquisition. Separate perf issue, not filed.
- 5-tap burst: 1 page ahead = 1.63-1.74 s vs 1.83-1.94 s; only 2 of 4 follow-up turns stayed resident because `invalidateNativePages` fires mid-burst.
- Cause: `Annotator.tsx` progress effect re-adds every highlight on the visible page on each progress change; foliate `addAnnotation` removes+redraws and emits `draw-annotation`; `useCapturedTurn` `handleCapturedSurfaceChange` treats that as changed pixels and drops all native pages. Also one invalidation via the reader-store `viewStateChanged` path right after a relocate (field not identified). Hits any book with highlights, single turns included.
- Removing an annotation emits no event, so captured pages can keep a deleted highlight (unverified).

PRs (2026-10-27): #7112 MERGED at its first commit (highlight-redraw fix) BEFORE its CodeRabbit fixes landed; follow-up #7114 (DOM-order compare + pre-drawn overlay check) OPEN. #7115 (ignore viewState.syncing, which only spins the View menu icon) OPEN. Remaining discard sources: toolbar show/hide (setHoveredBookKey + dismiss/showSystemUI) aborts turns while the toolbar is up; not investigated.

Gotchas: pre-push hook runs format+lint+full suite; never wrap `git push` in a short timeout, and read the push's own exit line, not the background task's. Worktree foliate-js can lag main after a rebase; fetch from https://github.com/readest/foliate-js.git inside the submodule if `git submodule update` says the commit is missing. Probe loops must have a hard step cap: an uncapped `while(key!==target) prev()` survived a CDP timeout and paged a user's book to the start.

Persimmon prototype (2026-10-27, exp worktree, not committed): PaperTurnModel.kt (Kotlin port of page-turn-core worklet: drag/press/turn/revert, forward single page), NativePaperView ES3 sheet + shadow shaders, NativePaperTurn animatePaper on Choreographer without per-frame acquisition wait. JS `__curlStyle` ('persimmon' default | 'classic'), `__curlTapSpeed` (default 2.5).

Prototype on device (2026-10-28, Hobbit, tap): new sheet draws a new image every 120 Hz frame (46 frames, max 8.3 ms); classic curl changes every other frame (16 frames, p90 17.4 ms, ~60 fps). Flaw: tapped sheet is visible ~125 ms, then ~290 ms of off-screen landing before the turn completes; end when the sheet leaves the screen and slow the tap (2.5 guessed). Measure distinct frames by diffing consecutive screenrecord frames: screenrecord emits a frame every vsync even when unchanged.

DECISIONS (owner, 2026-10-28): ship as a SEPARATE style named "Page Flip" (not a curl replacement); first PR Android only, option listed only where supported; desktop WebGL and iOS in later PRs. Ported code must carry the upstream MIT notice; keep the source app's name out of PR/commit text.

Not measured: iOS.

2026-10-29: owner tested the Android Page Flip build ("it works") and asked for iOS + desktop in the same work (branch feat/page-flip, worktree readest-feat-page-flip). Model now in three ports kept identical: PageFlipModel.kt, ios/Sources/PageFlipModel.swift, src/utils/pageFlipModel.ts (same 5 tests; removing UNTURN fails all three with a 0.138 jump). Desktop = PageCurlRenderer flip mode (src/utils/pageFlip.ts, WebGL 2 context requested ONLY for surfaces built with `pageFlip: true`; curl keeps WebGL 1 because existing browser tests and code call getContext('webgl')). Host option `isPageFlip` replaced NativePageTurn's `flip` option. Swift model/Metal checked by a scratch swiftc harness + runtime `makeLibrary(source:)` (no offline Metal toolchain installed).

**Gotcha:** a probe that sends `cover` outside the controller's `#queue` during a held turn overwrites native `turnId`; the turn's `finish` then mismatches, native `active` stays true, and every capture (and hand turn) is refused until the app restarts. Probes must queue behind `#queue` and refuse while a scene/session exists.

Related: [[ios-native-paper-curl-7046]], [[feedback-pin-adb-serial]].

2026-10-30: PR #7160 MERGED as 145e3318d, worktree removed (feat/page-flip, 2 commits: Page Flip + swift-rs `--build-system native` for Xcode 27.1). Owner asked for both in one PR. Not yet seen on iPhone by hand; macOS backward cover unverified in app.
