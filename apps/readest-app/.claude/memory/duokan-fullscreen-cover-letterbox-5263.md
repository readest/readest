---
name: duokan-fullscreen-cover-letterbox-5263
description: "#5263 THREE bugs fixed: covers letterbox (contain + black bars) instead of stretching; duokan-bleed positioned wrapper = blank page; rect-less restore anchor left #scrollBounds unseeded = swipe dead on cover until any tap-turn. Xiaomi device-verified."
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a2a5d20-fd55-4652-801b-c179b8adc316
  modified: 2026-08-03T16:06:50.346Z
---

Issue #5263 (2026-08-04: foliate#63 (letterbox+blank, 4088d28) + foliate#64 (swipe seed, f6bce4c) BOTH MERGED; #5473 MERGED — issue #5263 fully resolved):

**Behavior change decided by chrox in-thread + chat:** `duokan-page-fullscreen` covers no longer stretch (`object-fit: fill` + `preserveAspectRatio: none` removed). New behavior = real Duokan parity: image pinned inset-0 100%/100%, `object-fit: contain` (the general image rule), `background-color: #000` on the pinned element paints the letterbox bars. This supersedes the "stretch is intended" resolution of #5375 ([[svg-cover-stretch-duokan-5375]]).

**Second root cause found (blank cover page):** the King's Proposal 8 book declares `duokan-bleed: leftright` on `.illus`; Readest's `transformStylesheet` duokan-bleed handling (style.ts ~1042) adds `position: relative !important` to that wrapper, so the pinned img resolved `height:100%` against the wrapper -> wrapper 100% of zero-height body -> img 470x0 -> page renders BLANK. Fix: fullscreen branch forces `position: static` on ancestors between img and body (inline important beats stylesheet important). Reproduced on-device (v0.11.20 arm64 APK, API-36 emulator): page 1/247 fully blank.

- foliate-js commit fc7a8b5 on branch `fix/duokan-fullscreen-cover-letterbox` (paginator.js setImageSize); app branch `fix/duokan-cover-letterbox-5263` (temp-index built off origin/main, dev tree untouched) with submodule bump + browser tests + fixture `repro-5263.epub` (= repro-4379 + `<style>.cover{position:relative}</style>`).
- Scrolled-mode cleanup branch also removes `background-color` (el) and `position` (ancestors) now.
- Tests: `paginator-duokan-cover.browser.test.ts` 5 pass (letterbox assertions replaced the old `object-fit: fill` one).

**Swipe complaint (still open):** "swipe doesn't turn pages on cover page". Emulator repro on 0.11.20: swipe failed ONCE on the stretched cover but worked on the blank cover — however the headless emulator (hvf/Vulkan AND swiftshader) crashed 3x around exactly this test, so the observation is untrustworthy (likely mid-ANR). Web build + fix + CDP `Input.dispatchTouchEvent` swipes: cover page turns fine. Needs real-device re-check after the fix ships. Foliate touch listeners are `{passive:false}` on both the custom element and each iframe doc; no img-specific gesture code found in app or paginator.

**Sideways illustrations complaint = book's own script, not Readest:** the book (乐园杂音 07) ships `script.js` that on non-desktop UAs (`/windows|x11|mac/i` fails) adds class `change` -> `necessary.css` `img.change { transform: rotate(90deg); max-width:90vh; max-height:100vw }` to landscape `.kuchie` images so they fill a portrait phone page. Windows renders "normally" because the UA regex matches. By design (Duokan-ecosystem convention); reply on issue, no code change.

**Repro workflow that worked:** GitHub release APK (`gh release download v0.11.20 -p '*arm64.apk'`) + `emulator -avd Pixel_9_Pro -no-snapshot-load -no-window`; import via app "+" tile -> DocumentsUI (VIEW intents with file:// or shell content:// grants DON'T import); web import via drop-event needs DESKTOP UA context (drop did nothing with `isMobile: true` Playwright emulation); Playwright + `context.newCDPSession` + `Input.dispatchTouchEvent` gives real touch swipes on desktop Chromium (`hasTouch: true`), extension-world synthetic TouchEvents do NOT drive the app's gesture pipeline.

Related: [[duokan-fullscreen-cover-scroll]] (#4379 scrolled-mode gating, still valid), [[svg-cover-stretch-duokan-5375]].


**THIRD root cause (swipe dead on cover, device-verified 2026-08-04, foliate f0d39b4):** restoring at the cover resolves the saved CFI (`epubcfi(/6/2!/4/2,,/2)`) to a range `start=(div.cover,0), end=(img,0)` — end boundary INSIDE the pinned img -> `getClientRects()` EMPTY (abs-positioned content has no in-flow boxes). `#scrollToAnchor`'s `if (!rect) return` bailed without `#scrollTo`, `#scrollBounds` stayed unseeded, and `scrollBy`/`snap`'s unseeded guards silently dropped every swipe (Push style; finger trace: touchstart-unseeded -> 50x scrollBy-bail -> snap-bail). Any tap-turn seeds via `#scrollToPage` -> "works after you interact" = reporter's "sometimes, first open". Fix: rect-less bail (and zero-contentPages bail) falls back to `#scrollToPage(pagesBeforePrimary)` / scrolled `#scrollTo(viewOffset)`. `#afterScroll` refreshes `#anchor` to the visible range after page/snap scrolls so the fallback cannot cause stale jump-backs.

**Debug workflow that cracked it:** release+devtools build (`tauri android build -t aarch64 -- --features devtools`) + `__pgLog`/`__atLog` instrumentation read over CDP (`webview_devtools_remote_<pid>` forward). KEY TRAPS: (1) adb-synthesized gestures (`input swipe`, chained `input motionevent`) deliver touchstart/touchend but ZERO touchmove into the WebView — only real fingers drive the gesture pipeline; ask the user to swipe. (2) `tauri android build` reuses a STALE Next build cache — a "fixed" APK shipped the previous bundle (probe: leftover `__pgLog` global proved staleness); `rm -rf .next out` before the build. (3) Seeded-ness is probeable without instrumentation: `renderer.scrollBy(50,0)` moves `containerPosition` iff `#scrollBounds` is seeded. (4) `view.goTo({index})` no-ops from console; use `view.renderer.goTo({index, anchor})`. (5) The web harness can't repro the full swipe symptom (fill/expand timing differs; user confirmed web-unreproducible) — no browser regression test for the swipe, coverage is the letterbox/blank tests only.
