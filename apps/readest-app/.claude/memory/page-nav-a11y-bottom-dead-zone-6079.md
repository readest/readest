---
name: page-nav-a11y-bottom-dead-zone-6079
description: "#6079 bottom dead zone in scroll mode = the four hidden a11y page-nav buttons; 0.12.6 lacked #6001, and h-4 lost to h-20 by Tailwind sort order"
metadata: 
  node_type: memory
  type: project
  originSessionId: 091f163d-ec2e-40fe-875f-db5e8b295342
  modified: 2026-09-06T16:12:10.773Z
---

`PageNavigationButtons.tsx` renders four page/section buttons that stay mounted even when
hidden, because Android screen readers only announce them while they still hit-test.
That hack has produced a bottom-of-screen dead zone four times: #4501, #5966/#5974,
#6001, and now #6079 ("Dead zone with scroll mode", Android, 0.12.6, ~1/8 screen height).

**#6079's actual cause is a release gap, not new code.** Neither #5974 nor #6001 is an
ancestor of `v0.12.6` (v0.12.6 = f6146c217, 2026-08-28; #6001 = cd4a76fef, 2026-09-01).
In 0.12.6 the button className was `'flex h-20 w-20 ...'` plus a conditional `'h-4 w-4'`.
**Same specificity — Tailwind emits `.h-4` before `.h-20`, so `h-20` won and the override
was dead.** Result: two 80px-tall, ~164px-wide hit boxes in each bottom corner. #6001
fixed it by picking one size string (`navigationButtonSize` = `'h-2 w-2 overflow-hidden'`
or `'h-20 w-20'`), never two conflicting ones. **Never "override" a Tailwind sizing
utility with another of the same property — swap the whole token.**

**The fix, MERGED #6102 (f5399cdcc, 2026-09-06):** the Android exception is GONE.
`!isPageNavigationButtonsVisible && !appService?.isAndroidApp ? 'pointer-events-none'`
became just `!isPageNavigationButtonsVisible ? 'pointer-events-none'` on both
containers, so the hidden controls stop hit-testing on EVERY platform and there is no
bottom dead zone in any configuration. They take taps only once actually visible
(needs `showPaginationButtons` on AND the reader chrome shown). chrox rejected a
first attempt that kept the taps whenever the setting was off (gated on a
`captureHiddenTaps` flag) — simpler is right here, don't preserve the Android
carve-out.

`opacity-0` + `pointer-events:none` still leaves the buttons in Chrome's a11y tree, so
TalkBack linear (swipe) navigation reaches them either way; only explore-by-touch needs
the hit test.

Test: `src/__tests__/components/page-navigation-buttons.browser.test.tsx` (browser lane,
real Chromium + real `globals.css`). It asserts hit targets with
`document.elementFromPoint` at the button centre, so it catches CSS-order regressions
that a jsdom test cannot. `mockPlatform.showPaginationButtons` toggles the two modes.

Related: [[layout-ui-fixes]], [[eink-class-substring-matchers]],
[[daisyui-v5-tailwind-v4-migration]]
