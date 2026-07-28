---
name: invert-img-dark-override-5250
description: "#5250 invert image in dark mode dead when overrideColor on; #4763 emitted a second filter declaration (last wins) + multiply blend that is always black on black bg"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab4ff170-8d90-4b5a-858f-43c8e4403b2a
  modified: 2026-07-28T16:36:17.449Z
---

**#5250 "Revert image in dark mode don't work":** PR #5383 open (branch `fix/invert-img-dark-5250`, worktree `/Users/chrox/dev/readest-fix-invert-img-dark-5250`). VERIFIED on Xiaomi 13 (physical, 2026-07-29) with the reporter's EPUB: before = computed `grayscale(1)...` + `multiply` (invert discarded), after = `invert(1)` + `normal` (block) / `screen` (inline), equations readable. On-device CDP driving: `openFixtureBook`-style VIEW intent + scratchpad `cdp-eval.mjs`; UI settings not seedable on release builds (no run-as, no `__TAURI__` global) — the user toggled them by hand.

Root cause: PR #4763 (f7124cbee, 2026-06-24) rewrote the reflowable `img` rule in `getColorStyles` ([[css-style-fixes]], `src/utils/style.ts` ~L267) to:

```css
img {
  filter: invert(100%);                                  /* invertImgColorInDark */
  filter: grayscale(100%) contrast(1.2) brightness(1.2); /* dark+overrideColor, WINS silently */
  mix-blend-mode: multiply;                              /* overrideColor, now in dark too */
}
```

Two independent kills: (1) duplicate `filter` in one rule, last declaration wins, invert discarded; (2) `mix-blend-mode: multiply` against a dark page bg erases images (multiply with #000000 is always black — OLED-black theme users lose ALL images even without invert).

Fix: emit only one filter per state — invert wins in dark when the option is on and suppresses multiply; #4763's grayscale+multiply kept for invert-off dark override; light mode unchanged.

**Why:** template-literal CSS lets two branches emit the same property into one rule; string-contains tests pass while the browser discards the declaration.

**How to apply:** when a generated rule has multiple conditional lines for the same property, make branches mutually exclusive; test the cascade (collect all same-selector blocks, assert the LAST declaration), not string presence. Note the FXL path (`applyFixedlayoutStyles`) already composes filters into one declaration and uses `overlay`/`luminosity` (not multiply) for dark — reflowable multiply-in-dark for invert-off users still darkens photos on non-black dark themes (unfixed, watch for reports; reporter 1's photo case only fully resolves because they keep invert on). `p[width][height] > img:only-child { multiply }` is also unconditional in dark (untouched, potential same-class bug).
