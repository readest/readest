---
name: ios-last-page-scroll-clamp-5663
description: "#5663 last page unreachable on iOS 18 - cssAnimateScroll transforms shrink the container scroll extent and WebKit clamps the final scrollLeft; plus a headless self-driving iOS repro harness"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4a95bf5c-7219-4a96-9325-c19e6075a74f
  modified: 2026-08-13T10:01:45.244Z
---

Some EPUBs could not be turned to the last page on iOS: the turn animated, then snapped
back. PR readest#5678 + foliate#73 (branches `fix/ios-last-page-turn` /
`fix/last-page-scroll-clamp`), both OPEN as of 2026-08-13.

**Root cause.** `cssAnimateScroll` (packages/foliate-js/paginator.js) animates a turn by
putting `transform: translateX(-delta)` on every view element, then in cleanup clears the
transforms and immediately assigns `container.scrollLeft = endValue`. **Translating the
children shrinks the container's scrollable overflow by `delta`, and WebKit on iOS 18 keeps
clamping against that shrunken extent for the rest of the task.** Mid-book the clamp sits far
past the target and is invisible; on the last page the target *is* max scroll, so it lands a
full page short. `max` drops by exactly one page between the `#scrollNext` measurement and the
cleanup while the summed view widths are unchanged.

**A forced layout does NOT fix it** - `void element.scrollWidth` restores the *reported*
`scrollWidth` but the scroll clamp still uses the stale extent (measured:
`clamp-retry {end:125856, after:125445, sw:125859}`). Only a next-frame re-apply lands
(`clamp-raf {end:125856, after:125856}`). Fix = detect the short landing, re-apply in rAF.

**Why iOS-only / "some EPUBs".** `gpu-composite` is set only on iOS
(`FoliateViewer.tsx:764`); it makes the paginator skip the `rafAnimateScroll` fallback above
`RAF_ANIMATE_SCROLL_THRESHOLD` (20000px of accumulated views). Every other platform uses
rafAnimateScroll for a book that size - it writes scrollLeft directly per frame, no transforms.
So it needs a long book AND iOS. **Reproduces on iOS 18.5, NOT on iOS 26.3** - always test the
reporter's iOS major, `xcrun simctl create <name> <devicetype> <runtime>` for old runtimes.
Views before the primary are never trimmed (`#trimDistantViews` only trims after), so reading
straight through easily reaches 130k px of loaded views.

**Headless iOS repro harness** (works when computer-use is locked by another session; see
[[ios-sim-build-and-drive-workflow]]). No taps needed:
- temp patch `parseOpenWithFiles` to return `<documentDir>/repro.epub`; you MUST call
  `appService.allowPathsInScopes([dir], true)` first or ingest dies with
  `forbidden path ... allow-open permission in your capability file`.
- temp effect in `library/page.tsx` to `navigateToReader` the first book; temp async block in
  `FoliateViewer` after `setViewInited` to `goToFraction(0)` then loop `view.next()`, posting
  progress. Detect the bug by "stuck at page/pages" (`3/4` = broken, `0/1` = reached the end).
- `dbg()` in paginator both POSTs to a host `http://localhost:3210/collect2` collector (the
  sim shares the host network stack) AND paints a fixed overlay so
  `xcrun simctl io booted screenshot` always works.
- The app data container UUID changes on reinstall - re-copy the epub after every install.
- A standalone HTML page in sim Safari does NOT reproduce the extent shrink even copying
  cssAnimateScroll exactly; only the real WKWebView does. Don't trust a minimal repro here.

Worktree gotchas hit: `pnpm worktree:new` does not generate `gen/apple/Readest_iOS/Info.plist`
(run `pnpm tauri ios init`, then copy Info.plist from the main checkout; revert the
project.pbxproj churn before committing). Repeated iOS debug builds filled the disk
(`No space left on device` mid-cargo) - each build is ~320MB plus DerivedData.
