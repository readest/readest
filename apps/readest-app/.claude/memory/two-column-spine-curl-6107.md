---
name: two-column-spine-curl-6107
description: "PR #6107 (issue #6106) two-column Page Curl hinged at the spine — review findings, iOS-only cover, deterministic test failure, Xiaomi handoff"
metadata: 
  node_type: memory
  type: project
  originSessionId: ce290db5-d7d6-4b12-b726-6e3f5331a846
  modified: 2026-09-07T08:17:04.736Z
---

PR #6107 by @kad-air (branch `feat/two-column-spine-curl`, worktree `/Users/chrox/dev/readest-pr-6107`), closes #6106. Reviewed 2026-09-07; CI all green; NOT merged at review time.

**What it does:** with `renderer.columnCount >= 2` the curl turns only the outer column as a leaf hinged at the spine (`uLeaf` open x-interval in the vertex shader; radius decays to 0 so progress 1 is an exact reflection about x=w/2). The leaf's back samples a second texture — a capture of the incoming inner column taken *after* the instant nav, under a native iOS cover view (`cover_webview_region`/`uncover_webview_region`, a `resizableSnapshotView` sibling above the WKWebView that `takeSnapshot` does not render). Android/desktop reject the cover, so the back is theme paper and the canvas fades over the last 20% (`LEAF_FADE_START`).

**Math verified by hand (correct):** a leaf point at `w/2+d` lands at `w/2−d` and samples incoming `u = 2 − 2·vUv.x = 1 − 2d/w`, exactly that point's position inside the captured inner half; the rtl/backward branch (`u = 1 − 2·vUv.x`) matches too. Because both the hinge and `#captureIncoming` use `rect.width/2`, the landed leaf is pixel-exact against the live page **regardless of where the true gutter is** — asymmetric margins / landscape notch only shift the crease line by `(marginLeft − marginRight)/8`, a few px.

**Findings reported to chrox (not posted to the PR):**
1. `captured-turn.browser.test.ts > commits the incoming column when no overlay interferes` **fails deterministically on this Mac** (4/4, isolated, idle machine) while CI is green. Instrumented cause: the `this.#active !== active` guard after `createImageBitmap` (capturedTurn.ts ~line 844) bails because the turn already ended — headless Chromium's software WebGL makes the two `waitForPaint()` double-rAFs cost ~570 ms vs the 120 ms wait + 450 ms animation. Product-safe (losing the race degrades to paper back + fade) but the test asserts a race the code does not guarantee.
2. `INCOMING_WAIT_MS = 120` is awaited *before* `#playTo`, so every programmatic two-column turn on iOS freezes on the flat captured page for up to 120 ms before the curl starts. The wait could overlap the early animation (the back is barely visible at low progress).
3. Late `setIncoming` flips `canvas.style.opacity` from a partly-faded value back to `''` → one-frame brightness pop if the capture lands after progress 0.8.
4. Fixed-layout (`fixed-layout.js` has no `columnCount`) keeps the old whole-spread curl — PDF/FXL two-page spreads are not covered.

**Device state:** built + installed on the Xiaomi 13 (`pnpm dev-android` from the worktree, md5 `b158c52e21fe4e81308ce8c3cc405d89`, matches the device APK, installed 2026-09-07 16:13). CDP-probed: portrait `columnCount 1`, landscape `columnCount 2`, `captured-turn-style="curl"` — the leaf path IS reachable there, and a `view.next()` turn completes with no JS error. Android therefore exercises the **paper-back + fade** fallback only; the incoming-page-on-the-back half is iOS-only.

**CDP gotcha:** `Page.captureScreenshot` against the Android WebView appears to stall the renderer's rAF loop — five back-to-back shots during a 450 ms turn all came back at progress ~0 (old spread), then the final frame showed the new spread. Mid-turn frames need a held drag (touchMove without release), not screenshot polling; and my synthetic touchMove sequence was consumed as swipe-flips (pages advanced) rather than a scrubbed drag. See [[feedback-always-verify-on-xiaomi]], [[page-turn-styles-viewtransitions-555]].
