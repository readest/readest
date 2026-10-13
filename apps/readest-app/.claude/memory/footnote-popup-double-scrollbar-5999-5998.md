---
name: footnote-popup-double-scrollbar-5999-5998
description: "#5999 double scrollbars + #5998 jump button over the text in the footnote/note popup; root cause = child sized to the popup's border box"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a97da01-b326-4d8c-aab8-52730dfcaff8
  modified: 2026-09-01T09:57:14.374Z
---

Reported 2026-09-01 on 0.12.6 (macOS). Both issues live in `FootnotePopup.tsx`.
MERGED #6006 as 59cb6a776 (2026-09-01), UNRELEASED. Verified live in Chrome on a real
book plus a fixture EPUB; no device verify.

**#5999 root cause (CONFIRMED, browser-measured):** `Popup` puts the requested
width/height on `#popup-container` as a **border box** and draws a 1px border,
so its content box is 2px shorter on each axis. `FootnotePopup` handed the same
numbers to `.footnote-content`, which overflowed by exactly 2px both ways
(360 vs 358 measured). Because `overflow-y-auto` was on the container,
`overflow-x` computed to `auto` too (CSS: `visible` beside a non-`visible`
value becomes `auto`) — hence a spurious vertical **and** horizontal scrollbar
wrapped around the scrollbar the popup document already has.

Fix, three parts, all the same mistake in different places:
1. `.footnote-content` is `h-full w-full` — it fills the content box instead of
   restating the border-box numbers.
2. **Every size the popup computes is a content measurement** (`renderer.viewSize`,
   the probe paragraph's height) but the number handed to `Popup` is the outer
   box, so it must grow by the border: `popupSizeForContent(n) = n + 2 * popupBorder`
   (`popupBorder = 1`, next to `popupWidth`/`popupHeight`). Fixing only (1) moved
   the spurious scrollbar one level IN — foliate's own `#container` (part=container,
   `overflow:auto auto`) then reported `client 343x81 / scroll 343x83` and drew a
   15px classic scrollbar for 2px, which also stole 15px of width and forced an
   extra wrapped line. Verify by walking `foliate-view.shadowRoot` for anything
   with `scrollHeight > clientHeight`, not just the popup container.
3. The popup pins its scroll axis: `overflow-y-auto overflow-x-hidden`
   (reversed when `viewSettings.vertical`). Leaving the cross axis `visible`
   let CSS promote it to `auto`, so any stray pixel bought a second scrollbar.

**#5998 fix:** the "Jump to Location" button moved from the top chrome strip to
the popup's bottom corner — `right-2` normally, `left-2` when
`viewSettings.vertical || viewSettings.rtl`. Physical sides on purpose: the
corner follows the *book's* direction, which `start`/`end` (UI language) do not
track. Note `viewSettings.rtl` is also true when the **UI language** is RTL
(`getDirFromUILanguage()` in `FoliateViewer.tsx`), not only for RTL books. The
Back button stayed in the top strip.

**Verification recipe (reusable for any popup/reader CSS change):**
`src/__tests__/app/reader/components/footnote-popup-overflow.browser.test.tsx`
renders the real component with real `globals.css` under vitest browser mode.
Gotcha: the vitest browser test frame is **414x896**, not the 1920x1080 in
`vitest.browser.config.mts` — `useResponsiveSize` therefore takes the *phone*
branch (padding 12.5, not 10), and a fixture anchored far from the frame edge
squeezes the vertical popup to ~49px wide and breaks quadrant assertions. Put
the gridcell at `inset:0` and the note reference near its top-left.

Real-app check: a generated 2-note EPUB (`epub:type="noteref"` -> a
`div epub:type="footnote"` in a second spine item; only `aside[epub|type~=...]`
and `.epubtype-footnote` are hidden by `style.ts`, so a `div` target keeps the
Jump button) driven through `pnpm dev-web` with Playwright. Before:
`scrollW/H 360/99 vs client 358/97`, button top-right. After: no overflow on
either axis, button bottom-right.

See also [[footnote-popup-content-size-5887]] (the RO fit this builds on),
[[footnote-popup-jump-to-location-5766]] (the button itself),
[[daisyui-v5-tailwind-v4-migration]].
