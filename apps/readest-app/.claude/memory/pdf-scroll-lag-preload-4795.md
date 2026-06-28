---
name: pdf-scroll-lag-preload-4795
description: "PDF scrolled-mode rendering lag on Android (#4795/#4031) — fix via widened preload margin + bounded prioritized load scheduler in fixed-layout.js"
metadata: 
  node_type: memory
  type: project
  originSessionId: 902324ba-94ee-4c88-804e-ea9f796681f9
---

PDF **scrolled mode** showed blank pages while scrolling on Android (#4795, resurfacing #4031). Reproduced + fixed + CDP-verified on Xiaomi 13 (fuxi).

**Root cause (measured via CDP on-device):** per-page render (`pdf.js` `onZoom`→`render()`: canvas raster + text layer + annotation layer) ≈ **415 ms** uncached / ~65 ms cached, but the scrolled-mode IntersectionObserver used `rootMargin: '50% 0px'` (~0.5 page of lead). Loads also had **unbounded concurrency** (observer fired `#loadScrollPage` for every intersecting page) and **no viewport prioritization**, so the slow render never finished before the page scrolled into view, and a fling spawned dozens of competing renders. Per-page canvas ≈ **7 MB** at dpr 3 (screen-res, NOT the ~50 MB I first feared) → memory headroom existed; the #3470 OOM was byte-range *parsing* flood (`MAX_CONCURRENT_RANGES`, orthogonal).

**Fix** (`packages/foliate-js/`):
- `fixed-layout.js`: widened observer to `rootMargin: '200% 0px'` (~2 viewports lead); observer now only **flags `page.visible`** and calls new `#scheduleScrollPages()`.
- New pure exported `planScrollModePages({pages, currentIndex, maxLoaded, maxConcurrent, loadingCount})` → `{load, evict}`: loads **visible+idle pages nearest currentIndex first, bounded by `maxConcurrent - loadingCount`**; evicts **farthest non-visible loaded** beyond `maxLoaded`; **never evicts a visible page** (distance = `|index - currentIndex|`). Unit-tested in `src/__tests__/document/fixed-layout-scroll-scheduler.test.ts`.
- `#scrollMaxLoaded 8→12` (live-canvas cap = memory ceiling), `#scrollMaxConcurrent=3`, `#scrollLoadingCount` tracked in `#loadScrollPage` (inc on start, dec in `finally`, then reschedule so a freed slot pulls the next nearest page). Removed `#evictScrollPages` (scheduler handles it).
- **Terminal `error` state**: a load that throws or returns no src sets `state='error'` (not `'idle'`) so the post-completion reschedule can't retry a persistently failing page in a tight async loop (regression I introduced with reschedule-on-completion).
- `pdf.js`: `MAX_CACHED_PAGES 8→16` (page objects + render blobs are cheap, not the canvas) so back-scroll within the wider window doesn't re-parse.

**Verified (CDP + screenrecord, identical 9-swipe reading-pace test, fresh region):** baseline = mostly blank frames, settled forward lead **+2** (span [-9,+2]); fix = **every frame fully rendered**, forward lead **+4** (span [-7,+4]). Extreme 8-fling (240 pages/2s) still blanks mid-fling (inherent) but settles to rendered content and **no crash**.

**Best-practice cache strategy for scrolled PDF on mobile** (asked during this work): two bounded tiers — live-canvas cap = the hard memory ceiling (sized to window+lead), decoded-page cache a bit larger (cheap); distance/viewport-aware LRU never evicting visible; bound+prioritize loads; release bitmaps eagerly (`canvas.width=0`); the biggest unused lever for low-end devices is **capping effective DPR** (canvas mem ∝ DPR²) — not applied here since 12×7 MB≈84 MB is fine on the Xiaomi.

**CDP on release builds:** the installed Play/release 0.11.12 has **no `webview_devtools_remote_<pid>` socket** — WebView debugging is gated behind the `devtools` Cargo feature (`src-tauri/Cargo.toml`); must build+install `pnpm dev-android` (release + `--features devtools`, same keystore so it updates over the store build, library preserved). CDP `webSocketDebuggerUrl` comes back as `ws://localhost/devtools/...` **with no port** (echoes Host header) → rewrite to `ws://127.0.0.1:9222<path>`; `ws` npm pkg is CJS so import default + destructure. See [[cdp-android-webview-profiling]], [[pdf-oom-range-flood-3470]].

**WIP caveat:** during this work the foliate-js submodule had unrelated uncommitted `paginator.js` WIP (background-anim perf, #4785) — exclude it from any #4795 commit.
