---
name: highlight-style-buttons-preview-colors
description: "Highlight style buttons (A / A-underline / A-squiggly) preview the color each style would apply (MERGED #5578); resolve colors as customColors[c] || c because customHighlightColors is SEEDED with the whole default palette"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4588a1f-b5f1-488d-808e-c68a581a17b5
  modified: 2026-08-08T14:35:00.840Z
---

`HighlightOptions.tsx` style row shipped previewing colors the annotation would
never use: the marker swatch was hardcoded `HIGHLIGHT_COLOR_HEX['yellow']` and
the underline / squiggly rules inherited `base-content`. MERGED #5578
(`7e07e1b40`, 2026-08-08) — each button now previews `resolveStyleColor(style)`.

**The color model.** Each style carries its OWN color binding in
`globalReadSettings.highlightStyles[style]` (highlight / underline / squiggly),
and `handleSelectColor` writes only to the *selected* style's slot. So the row
shows three potentially different colors at once — a button previews what
tapping it would apply, not the globally selected color.

Gotchas:
- **Resolve with `customColors[c] || c`**, matching the color strip's dots.
  `customHighlightColors` defaults to the ENTIRE `HIGHLIGHT_COLOR_HEX` map (see
  `DEFAULT_READSETTINGS`), so named colors like `'violet'` resolve to a hex
  through it; user-added colors are already hex and fall through. Skip the
  lookup and a customized palette silently renders stock shades. A test fixture
  with `customHighlightColors: {}` is UNREALISTIC — it makes the code look
  broken by returning bare names (which happen to be valid CSS color keywords,
  so it fails quietly rather than loudly).
- **Read local `selectedColor` before the store** for the selected style:
  `saveSysSettings` lands a tick later, so reading the store alone makes the
  swatch lag one tap behind.
- Color the *rule*, not the letter, for underline/squiggly — foliate's
  `overlayer.js` strokes the line in the annotation color and leaves text ink
  alone. The highlight branch is the opposite: colored background + fixed dark
  ink `#1f2937` (`base-content` would go white on a light marker in dark
  themes). Dark ink is safe only because the palette is all light tones; a dark
  user color would be dark-on-dark, same as the strip's `FaCheck`.
- B&W e-ink takes `einkFgColor` for both swatch and rule — no color to show.

`annotation-popup-layout.browser.test.tsx` did NOT catch this class of change:
`allowedMismatchedPixelRatio: 0.02` swallows a 2px rule on a 16px glyph. Its
baselines are tracked PNGs and stayed green (mildly stale).

Related: [[feedback-no-config-mirror-tests]] (this fix's render test is the
contrast case — it failed red on the hardcoded yellow).
