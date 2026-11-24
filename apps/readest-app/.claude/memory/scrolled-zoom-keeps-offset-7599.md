---
name: scrolled-zoom-keeps-offset-7599
description: "#7599 font zoom in scrolled mode kept the pixel offset, not the text: foliate onExpand skips re-anchor when scrolled; fix in setStyles (foliate #175, readest PR #7610); stage the submodule only on the -on-pin branch"
metadata:
  node_type: memory
  type: project
  originSessionId: 5fc89daa-7568-4f77-95e2-97548bfd3942
  modified: 2026-11-18T07:39:37.995Z
---

#7599 (macOS 0.12.20, 2026-11-17): changing font size (Cmd +/-, which sets `defaultFontSize` in reflowable books) lost the reading position. Reproduced 2026-11-18 on dev-web, Chromium and WebKit: **scrolled mode only**. Paginated mode kept the first visible paragraph on the page.

- Cause: foliate `onExpand` returns early in scrolled mode (`if (this.#filling || this.#stabilizing || this.scrolled) return`, from continuous scroll e925e9d) so preloads and late images don't move the scroll. Font changes reflow through the same path, so the offset stayed and the text moved.
- Fix: `setStyles` records `#getVisibleRange()` before restyling, waits for `fontsReady → expand` on every view, then `#scrollToAnchor`s, only when the primary view's size changed (a color-only restyle otherwise nudges ~3px). readest/foliate-js#175 MERGED 0bc34d0 (same patch); cherry-pick `fix/scrolled-restyle-anchor-on-pin` (02653a5) pinned in readest #7610, MERGED e44bd6cf7 (2026-11-18). Test: `paginator-scrolled-restyle-anchor.browser.test.ts`.
- Repro script: Playwright temp config on :3007 with chromium + webkit projects, a 600-numbered-paragraph EPUB, `goToFraction(0.5)`, Shift+J for scrolled mode, Meta/Control + Equal/Minus, read visible `p[id]` via `renderer.getContents()` and each iframe's rect.

**Why:** after cherry-picking onto the main-based branch, I ran `git add packages/foliate-js` while the submodule was still checked out on that branch. The commit pinned the wrong sha, and the pre-push lint caught it (footnotes exports missing).
**How to apply:** check out the `-on-pin` branch in the submodule before staging it, and check `git ls-tree HEAD packages/foliate-js`. See [[cfi-range-start-between-children-7482]] for the on-pin workflow.
