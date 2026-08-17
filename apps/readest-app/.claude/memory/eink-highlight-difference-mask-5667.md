---
name: eink-highlight-difference-mask-5667
description: "B&W e-ink highlight fill is a difference-blend inversion mask (always white), not a paint color; black is the blend identity"
metadata: 
  node_type: memory
  type: project
  originSessionId: eb38cb03-e7cd-4bde-9139-101b0811baf3
  modified: 2026-08-16T05:49:29.066Z
---

#5667 "Cannot highlight text". MERGED #5735 (c42be6bc). Three separate defects, one issue. Device verify pending.

**1. Highlight overlay invisible in dark B&W e-ink.** `useTheme.ts` sets
`--overlayer-highlight-blend-mode: difference` + opacity `1.0` when
`isBwEink`. Difference is `|backdrop - source|`, so **black is the identity
element** — a black fill leaves the page pixel-for-pixel unchanged.
`Annotator.tsx` filled with `einkBgColor = isDarkMode ? '#000000' : '#ffffff'`,
so dark mode drew nothing. The fill is an **inversion mask, not paint**: white
inverts page<->ink in BOTH themes, so it must not follow the theme.
Fix = `getAnnotationOverlayColor(style, hex, {isBwEink, isDarkMode})` in
`annotatorUtil.ts`. Underline/squiggly are NOT blended (only
`Overlayer.highlight` sets mixBlendMode) so they keep the theme ink.
`useTTSControl.ts` had the identical bug AND gated on `isEink` instead of
`isBwEink` (color e-ink multiplied with white = no-op).
Overlays are NOT redrawn on theme switch — that's why light-after-dark stayed
broken until reload. Theme-independent fill removes the staleness too.
STILL UNFIXED: `transientHighlight.ts` hardcodes `#808080`, never e-ink aware.

**2. `[class*='text-base-content']` `!important` beats inline `color`.**
globals.css:525. Any element that sets its own ink inline AND carries
`text-base-content` gets flattened in e-ink. Bit the HighlightOptions marker
glyph (black 'A' on black chip) and the selected-color check. Fix = don't emit
the class when the color is explicit. See [[eink-class-substring-matchers]].

**Why:** the mask/paint distinction is invisible in the code — the draw call
just says `color:`. Anyone "fixing" the dark-mode fill to match the theme
re-breaks it.

**How to apply:** before touching any e-ink overlay color, check whether the
overlay is blended. Grep `--overlayer-highlight-blend-mode` in `useTheme.ts`.
If blended: white always, never the theme background.
