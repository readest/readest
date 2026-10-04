---
name: pdf-scroll-ios-lag-dom-size
description: "iOS scrolled-PDF lag on huge PDFs (Feynman, 2752 pp): one .scroll-page per page in the DOM + pageColors reassigned on every load re-rendering every loaded page; fix = virtualized strip (computed offsets, abspos window) + pageColors equality guard; foliate#121 MERGED (97e44bf) + readest#6626 MERGED (adf3b9521) UNRELEASED, iPhone-VERIFIED; iOS momentum stop at page tops = header visibility toggle, fixed by hiding PDF chrome by layout"
metadata:
  node_type: memory
  type: project
  originSessionId: 224bb1af-96c7-42b4-ac1e-0978b3e5553f
  modified: 2026-10-04T13:46:13.243Z
---

Investigated 2026-10-04 on iPhone XS Max (iOS 18.7.10, release 0.12.10) with the Feynman Lectures PDF (2752 pages, 31 MB). Scrolled mode was unusable on iOS but smooth on the Xiaomi.

**Two causes (measured live on device):**
1. `#initScrollMode` (foliate `fixed-layout.js`) put one `.scroll-page` flex item per page in the DOM. The in-app scripted 20-page scroll gave 20 frames in ~7 s, worst 833 ms. Hiding all but ~100 placeholders gave 420 frames, worst 29 ms. `contain: strict`, `content-visibility: auto` and `touch-action: auto` did NOT help.
2. `FoliateViewer.tsx` docLoadHandler sets `renderer.pageColors = getPDFPageColors(...)` on EVERY section load, and the setter always called `#render()`. In scroll mode that re-rendered every loaded page: the async pdf.js `render` returns a promise even when its signature guard skips, so `#refreshOverlayerForFrame` rebuilt every overlayer. Counted 274 `create-overlayer` events per 20 loads. A setter guard alone on the device: 274 -> 40 events, but frames still reached 780 ms with the full DOM, so (1) dominates.
- TRAP: injecting the old renderer as a second custom element (no Readest listeners, app renderer switched to paginated) scrolled smoothly (407 frames, worst 44 ms). DOM size hurts only together with the per-load O(n) relayouts that the in-app listeners trigger. Benchmark in-app, not standalone.

**Fix:** foliate PR readest/foliate-js#121 (branch fix/fxl-scroll-virtualize) and readest PR #6626 (branch fix/pdf-scroll-virtualize, worktree `readest-fix-pdf-scroll-virtualize`), #121 MERGED as 97e44bf; #6626 MERGED (adf3b9521) UNRELEASED; worktree + branches (local, readest remote, foliate remote) removed 2026-10-04.
- **DEVICE-VERIFIED 2026-10-04** (devtools build of the branch via `pnpm dev-ios` from the worktree, iPhone XS Max): same in-app 20-page scroll = 394-402 frames, worst 57-63 ms (was 20 frames / 833 ms); overlayers 40 per 20 loads (was 274); 12 pages mounted; steady scroll 16.7 ms/frame (was 37). CI on #6626 all green, no review findings. The iPhone still runs this devtools build. For the worktree iOS build: rsync the ignored gen/apple files from main (`--ignore-existing`), then clear `target/aarch64-apple-ios/release/build/*/out/swift-rs/*/arm64-apple-ios/release/ModuleCache` before AND after.
- `layoutScrollPages` computes offsets like the old flex column (`gap*zoom` margin on both sides, `overlap` pull-back).
- `findScrollPageRange` does the binary search.
- `#updateScrollWindow`, run from the scroll handler, mounts pages within [pos-2V, pos+3V] plus any loading/loaded, in index order. The IntersectionObserver was REMOVED.
- Anchors are in progression space.
- The `pageColors` setter returns early when nothing changed.
- WebKit-only test diffs (CI is Chromium): pan-lock tests query `.scroll-page` synchronously after `open()` (WebKit has no host style yet, so mount happens a frame later); horizontal `next()` smooth `scrollBy` in the same task as the open-time scroll starts from the uncommitted position.

**Follow-up 2026-10-04: iOS flings stopped dead at every page top.** NOT a scroll write: global `Element.prototype.scrollTop` and `scrollTo` hooks logged none during the coast. Cause: #6605's `usePageEdges` toggled `visibility` (the `invisible` class) on the `mix-blend-difference` header as a page top crossed the viewport, and every flip reset iOS momentum.
- The footer flips survived in one fling.
- The bare renderer as an overlay coasted.
- CSS pinning `.sectioninfo.invisible { visibility: visible }` coasted.
- `opacity:0 + pointer-events:none` also coasted.
- `pointer-events:none` alone did NOT help.

chrox then questioned the page-edge UX itself (unpredictable flashing) and chose to hide by LAYOUT. `usePageOverflow` / `isPageOverflowing` replaced `usePageEdges`: always hidden in vertical scroll flow, hidden when `scrollHeight > clientHeight + 1`, shown when the page fits. These are commits 08addd35c (foliate re-pin to merged 97e44bf) and a61a0de62 on #6626. Not yet verified in a device build.
TRAP: my body MutationObserver cap (3000) was silently exhausted by 24 `<input>` name/type rewrites per React re-render, which hid the later header toggles and briefly misled me. Don't cap, or filter INPUT mutations.

**Device recipe:** the release build IS inspectable over USB: `ios_webkit_debug_proxy -u <udid>:9230 -F`, then send WebKit-protocol `Runtime.evaluate` to `ws://127.0.0.1:9230/devtools/page/1`.
- Messages must be wrapped in `Target.sendMessageToTarget` (targetId from `Target.targetCreated`).
- `awaitPromise` returns `{}`, so stash results on `window` and read them back.
- Timeline timestamps come back as 0 (counts and clip rects are still usable).
- `window.next.router.push('/reader?ids=<hash>')` opens a book.
- Load a modified renderer as `customElements.define('foliate-fxl-v2')` from a blob URL (strip the polyfill import) and `open(document.querySelector('foliate-view').book)`.
- An instance-level `Object.defineProperty(renderer, 'pageColors', ...)` wraps the setter without a build.

Related: [[pdf-scroll-lag-preload-4795]], [[scrolled-pdf-pinch-zoom-4817]], [[webtoon-zoom-seam-6484]].
