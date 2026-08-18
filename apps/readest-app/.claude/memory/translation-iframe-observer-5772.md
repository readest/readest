---
name: translation-iframe-observer-5772
description: "PR #5772 measured findings - cross-document IntersectionObserver is NOT broken, and allTextNodes is index-coupled so filtering it at walk time breaks read-ahead"
metadata: 
  node_type: memory
  type: project
  originSessionId: cc6534d1-7cd7-42a5-987c-881a7fc3f172
  modified: 2026-08-18T18:22:19.759Z
---

PR #5772 (`useTextTranslation.ts`) MERGED 2026-08-18 as `9fb8266bf`. I pushed 2 extra
commits onto the contributor's branch before merge (`ed1ed3b4c`, `1d21e3036`).

**The PR's stated root cause is FALSE and I measured it.** The description claimed "a
top-level `IntersectionObserver` treated visible iframe text as off-screen, so regular
chapter paragraphs were not translated". Not reproducible. Observing every node
`walkTextNodes` returns twice, once with `window.IntersectionObserver` and once with
`iframeDoc.defaultView.IntersectionObserver`, against a real `foliate-paginator` +
`sample-alice.epub`: 40 nodes, 3 documents, all 40 inside iframes, both reported all 40,
**0 disagreements**. Same across synthetic layouts (iframe fully visible / iframe sized to
whole section with wrapper clipping / section parked off-viewport). Per spec the
compute-the-intersection algorithm walks up through the browsing context container and
clips at each nested viewport, so implicit-root observation across an iframe boundary
works by design. `document.defaultView?.IntersectionObserver ?? IntersectionObserver` is
**inert on Chromium** (covers WebView2/web/Android/Linux). Left in place only because
WKWebView is UNTESTED - if an iOS translation bug shows up, test that first.

The real fix hiding in commit 1 (undocumented by the author): the old code did
`observerRef.current = createTranslationObserver()` on every section `load` WITHOUT
disconnecting the previous one, leaking an observer + its retained target set per load.

**`allTextNodes.current` is INDEX-COUPLED - never filter it at walk time.** Two consumers
address it by index: `getTranslationContextNodes` slices a window around visible nodes,
and `findNodeIndicesInRange` maps the reading position to a slot. The PR's
`excludeTranslationNodes` dropped already-translated paragraphs, and since
`observeTextNodes` re-walks the whole view on every section `load` (multiview preloads
adjacent sections, so it fires during ordinary reading), the reading position stopped
resolving mid-chapter: `translateInRange` logged `Range not found in text nodes` and the
+5 read-ahead died. Fix = `resolveTranslationSourceNodes`: drop `.translation-target`
wrappers, but FOLD a `.translation-source-hidden` wrapper back to its parent paragraph
rather than dropping it. Safe because `scheduleTranslation` and `translateElement` both
already bail on `el.querySelector('.translation-target')`.

Two DOM shapes `walkTextNodes` emits for a translated paragraph, both must be handled:
- source visible: the `<p>` itself (it has direct text)
- source hidden: NOT the `<p>` (no direct text, so the walk descends past it) but the
  `.translation-source-hidden` and `.translation-target` `<font>`s

`.translation-source-hidden` is `display: none !important` (`style.ts:764`), so a paragraph
with neither a target nor a visible original renders BLANK. `updateTranslation` used to
strip targets without restoring source visibility - fixed in `1d21e3036`.

Still UNFIXED: `document` param shadowing in `createTranslationObserver` /
`getTranslationContextNodes` / `observeTextNodesByDocument`; `createTranslationTargetNode`
and `setSourceVisibility` still use the GLOBAL `document.createElement('font')` and rely on
implicit adoption into iframes, 3 lines from `el.ownerDocument.createDocumentFragment()`.

Verifying browser-engine claims: `pnpm test:browser` (real Chromium via Playwright) with a
real `foliate-paginator` + `src/__tests__/fixtures/data/sample-alice.epub` is the tool.
`vitest.browser.config.mts` sets `onConsoleLog` to swallow stdout, so `console.log` in a
browser test is INVISIBLE - surface values by forcing an assertion diff
(`expect(results).toEqual({FORCE:'DIFF'})`) instead. Take the SETTLED observer state after
a dwell, not the first callback, or you measure pre-layout noise.

See [[bug-patterns]], [[worktree-new-rebases-pr-force-push]], [[css-style-fixes]].
