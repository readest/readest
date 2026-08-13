---
name: ios16-fonts-ready-webcontent-crash
description: "iOS <=16 WebContent SIGTRAP on every book open - fonts.ready resolved synchronously during style purge; fix = fontsReady() helper in foliate paginator, gate = AppleWebKit/605 UA without URL.canParse"
metadata: 
  node_type: memory
  type: project
  originSessionId: d614429d-6a47-444d-a1bf-18362eca274f
  modified: 2026-08-12T16:18:00.220Z
---

Reported 2026-08-12 by a lifetime supporter (iPhone 8 Plus, iOS 16.7.16): every EPUB open crashed to home screen, `com.apple.WebKit.WebContent.ips` each time, NO jetsam (not OOM). MERGED 2026-08-13: foliate#71 (squash -> cf9829d) + app readest#5654 (squash -> 709a39ff3, includes `scripts/ios16-fonts-ready-repro.py`). Worktree removed, branches deleted, submodules re-registered after the worktree:rm deinit ([[worktree-rm-deinits-shared-git-config]]). STILL PENDING: iOS 16 device verify (needs reporter/TestFlight — reply to the reporter once a build ships) and the iOS 15.7 repro-page question (run `python3 apps/readest-app/scripts/ios16-fonts-ready-repro.py`, open the printed URL in device Safari; survives = iOS 15 train lacks the fatal assert).

**Crash chain (verified against WebKit safari-7615-branch sources, not guessed):**
`Style::Scope::createDocumentResolver` → `CSSFontSelector::buildStarted` → `CSSFontFaceSet::purge` removes a still-`Loading` @font-face → `decrementActiveCount()` hits 0 → `FontFaceSet::completedLoading` → `m_readyPromise->resolve()` **synchronously inside style resolution** → `DeferredPromise::callFunction` release assert → SIGTRAP kills WebContent.

- WebKit 7615 (iOS/Safari <=16): `callFunction` defers only on `activeDOMObjectsAreSuspended()`.
- WebKit 7616 (iOS/Safari 17+): added `|| !ScriptDisallowedScope::isScriptAllowedInMainThread()` → queues a task → no crash. Same release shipped `URL.canParse` → clean feature-detect proxy for the buggy engine: `ua.includes('AppleWebKit/605') && typeof URL.canParse !== 'function'` (also covers iOS 15 and old-macOS WKWebView; iPadOS masquerades as Mac so UA version sniffing is useless).

**Why Readest hit it deterministically:** paginator.js accessed `doc.fonts.ready` on every section load and in `setStyles` — the JS deferred promise ONLY exists if `.ready` is accessed (`DOMPromiseProxy::m_deferredPromises` empty otherwise → purge never calls into JS). Readest injects @font-face (bundled/custom fonts, [[css-style-fixes]]) so fonts are mid-load when theme/view-settings `setStyles` swaps stylesheet textContent right after load → next style pass purges → boom.

**Fix:** exported `fontsReady(doc)` helper in foliate paginator.js — healthy engines return `fonts.ready` unchanged (Firefox resize-observer workaround preserved); buggy WebKit polls `fonts.status === 'loaded'` at 100ms via the iframe's own window (timers die with the doc); detached doc (`!defaultView`) resolves immediately. Tests: `foliate-fonts-ready-webkit.test.ts` imports the real paginator.js (works fine in vitest, pattern from foliate-paginator-a11y.test.ts).

**iOS 15.7 non-repro (chrox real device, 2026-08-12):** the public iOS 15 branch (`safari-613`) is IDENTICAL in every crash-relevant spot (purge in buildStarted, missing callFunction guard, FontFaceSet gating) — so source alone predicts iOS 15.7 crashes too. Two candidate explanations: (a) the fatal RELEASE_ASSERT is security-train hardening present only in iOS 16.7's shipped build 8615.8.1.10.3 (7615.8.x tags are NOT on public GitHub; branch tips != shipped builds), or (b) app-side timing — no font mid-load at the setStyles swap on that device/build. Standalone engine repro page distinguishes them: `apps/readest-app/scripts/ios16-fonts-ready-repro.py` (worktree, uncommitted) — hanging font + `.ready` + style swap; validated on Chrome + macOS Safari 18 (both survive; server log shows the hanging font fetch = harness armed). If iOS 15.7 Safari survives the page → engine unaffected there → fix gate merely conservative (poll fallback harmless).

**Promise-pending precondition (why the repro page v1 was inert):** `FontFaceSet` ctor resolves `.ready` at creation unless `!loadEventFinished() || processingLoadEvent()`; `completedLoading()` is gated on `m_isDocumentLoaded`; `documentDidFinishLoading()` runs in `implicitClose` right AFTER load dispatch and resolves unless a face is actively loading. So the crash needs: `.ready` accessed inside the load handler (foliate line 757 does), font fetch STARTED before the handler returns (foliate's forced layout does), then a later stylesheet swap. A hanging font in initial markup blocks the load event itself → gate never opens → no crash.

**Traps for next time:**
- FontFaceSet `loadingdone`/`loading` events are NOT implemented in WebKit ≤7615 (attempted 2026 in 305367@main, then reverted) — an event-based fallback is dead on arrival; polling is the only safe primitive.
- Iterating `document.fonts` (creating FontFace wrappers) sets `m_mayBePurged=false` and would also mask the crash, but leaks faces across every setStyles rebuild — do not "fix" it that way.
- `WTFCrashWithInfo` x0 register = assert line number, x1/x2 = file/function strings — useful for pinning inlined asserts in .ips logs.
- Fetching the WebKit repo (even `--depth=1`) times out; use raw.githubusercontent.com per-file against `safari-76XX-branch` refs.
