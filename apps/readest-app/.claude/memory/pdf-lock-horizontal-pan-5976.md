---
name: pdf-lock-horizontal-pan-5976
description: "#5976 lock horizontal panning for zoomed fixed-layout pages: THREE layers (host touch-action, per-frame mirror, pdf.js JS pan) + a scrollLeft snapshot #showSpread's frame swap would otherwise clamp to 0"
metadata:
  type: project
---

Issue #5976 (titled "lock vertical", body asks for **horizontal**): on a phone a
zoomed PDF crops its wide side margins, but the page drifts sideways while
reading and has to be re-centred constantly. Shipped as a ViewMenu toggle
(`Lock Horizontal Panning`, next to Webtoon Mode), per-book
(`saveViewSettings(..., skipGlobal=true, applyStyles=false)`), driving a
`lock-pan-x` attribute on the `<foliate-fxl>` renderer. Branch
**MERGED**: foliate-js#89 as `b1fe9d3`, then readest#6030 as `63fb3230e`
(2026-09-02). Xiaomi-verified before merge; no post-merge device re-check.
Worktree removed, local branches deleted; the foliate-js remote branch
`feat/lock-pan-x` was still up at last check. The rebase onto b12932da9
conflicted in all 34 non-en locale files, because #6027 (Gamepad Support)
appended its keys at the same spot; resolution = keep both key sets
(`en/translation.json` carries neither, by the key-as-content convention).

CodeRabbit's only finding was tr terminology; rejected after a cross-locale
audit - see [[i18n-match-established-locale-terms]].

## The lock needs THREE layers - any one alone is a no-op on a real device

1. **Host CSS.** Scrolled flow ships `touch-action: pan-x pan-y`, so a slightly
   diagonal one-finger swipe scrolls x too. Locked rule sets `touch-action:
   pan-y` on the host *and* `.scroll-page`. Two fingers stay unlisted so pinch
   still reaches JS (base was already `pan-x pan-y`, so browser pinch-zoom was
   never on: the lock only drops the `pan-x` token and **cannot** regress zoom).
   `:not([flow="scrolled"][scroll-direction="horizontal"])` exempts horizontal
   scroll (x is the reading axis there); the menu item is `disabled` there too.
2. **Per-frame mirror.** `touch-action` **does not cross an iframe boundary** -
   a touch that lands on page content is governed by *that document's* value, so
   the host's `pan-y` never reaches it. `#applyPanLock(doc)` writes
   `doc.documentElement.style.touchAction` from both frame load handlers
   (`#createFrame`, `#createScrollFrame`) and from the `lock-pan-x`
   attributeChangedCallback.
3. **`pdf.js` `setupPanningEvents`** - the layer that actually matters for a
   zoomed PDF. Panning there is **JavaScript, not native scrolling**: an
   `onpointermove` handler writing `scrollParent.scrollLeft` directly, which no
   `touch-action` value can constrain. It now reads the mirrored lock back
   (`doc.documentElement.style.touchAction === 'pan-y'`) and skips the x write.
   The function had to be `export`ed to be testable.

**This is why the CSS-only version tested green in a browser and failed on the
device** ("It does not work, I can still horizontal pan with the lock"): the JS
pan only runs when there is no text (`SPAN`/`P`) under the pointer and no
selection, so a swipe starting **over text** fell through to native scroll and
was correctly blocked, while one starting anywhere else used the JS pan and was
not. Inconsistent per-swipe results = look for a second, scripted path, not a
timing/compositor flake.

## Paginated flow: snapshot scrollLeft in #showSpread, not #render

Paginated flow re-centres `scrollLeft` on *every* render
(`computePaginatedScroll`), so each page turn undoes the crop. Reading
`container.scrollLeft` inside `#render()` is **too late on a page turn**:
`#showSpread` first makes the outgoing frames `position:absolute`, which
collapses the host's scrollable width, and the browser clamps `scrollLeft` to 0
*before* `#render()` runs - so the lock faithfully preserved 0. Proved with
console logs: `showSpread:preswap 340` -> `showSpread:postswap 0` -> `render 0
pageTurn true`. Fix = `#pannedX` snapshot taken in `#showSpread` before the
swap, consumed and cleared at the top of `#render()`; `#render` otherwise falls
back to `this.scrollLeft` read before `transform()` resizes anything, which also
covers the `#goLeft/#goRight` portrait turns.

## Verification

Browser (`pnpm dev-web`, 627-page PDF): toggle flips `lock-pan-x` and computed
`touch-action`; `scrollLeft` 300 survives two page turns and a footer next-page
click while `scrollTop` still resets to 0 (#4683). See
[[verify-dev-web-serwist-stale-locales]].

Xiaomi 13 / Android 16 (device 368b0948, `pnpm dev-android` + CDP), scrolled
vertical, `scale-factor=175`:
- before the pdf.js fix: one horizontal swipe moved scrollLeft 141 -> 283, and
  six vertical flings walked it 295 -> 190 -> 98 (exactly the issue's report)
- after: 8/8 alternating swipes gave dSl=0, vertical fling dSt=410/dSl=0,
  **diagonal** swipe (-40,-220) dSt=282/dSl=0, six flings held scrollLeft at 150
- pinch still zooms under the lock: scale-factor 175 -> 303 -> 158
- menu row toggles both ways: ON -> dSl=0, OFF -> dSl=186
- survives `location.reload()` (attribute re-applied, fresh frames re-mirrored)

**CDP gotcha:** the reader's `.header-bar` sits at `opacity: 0` +
pointer-events-none until revealed, so clicks at the `View Options` button's
coordinates silently hit nothing and the menu never opens. Reveal it first
(`Input.dispatchTouchEvent` tap near y=6) and check `getComputedStyle(hdr)
.opacity !== '0'` before clicking. Menu items respond to
`Input.dispatchMouseEvent` (mousePressed/mouseReleased); a synthesized
`touchStart/touchEnd` tap on the same button did **not** open the dropdown.
Also: a second click on the trigger *closes* an already-open menu, so probe
`items()` before clicking. See [[feedback-always-verify-on-xiaomi]].
