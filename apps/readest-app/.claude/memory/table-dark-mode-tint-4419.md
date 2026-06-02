---
name: table-dark-mode-tint-4419
description: "Dark-mode table tint must stay gated on overrideColor; blanket `table *` color-mix breaks plain tables AND vertical-TOC spacer cells"
metadata: 
  node_type: memory
  type: project
  originSessionId: 114eeb22-c9b6-480d-8305-3a3190855638
---

`getColorStyles` in `src/utils/style.ts` has a rule:
`blockquote, table * { background-color: color-mix(in srgb, ${bg} 80%, #000) }` in dark mode.
The `table *` part **must** be gated on `overrideColor` — `${isDarkMode && overrideColor ? ...}`.

**This gate has regressed twice.** #2377 (PR #2379) first added it ("avoid overriding
table background by default"). #4055 (commit `cead0f42e`, closes #4028/#4029) **removed**
the gate to darken illegible white zebra-stripe rows — which re-broke it and caused #4419:
*every* dark-mode table (and its cells) gets a tint a few shades off the page bg, even
tables with no background of their own.

Why the gate is safe now: #4392 (`176b950c9`) added light-background rewriters that map
only actually-light backgrounds → page `bg` in dark mode, regardless of overrideColor —
`getDarkModeLightBackgroundOverrides` (inline styles) + the `transformStylesheet` dark-mode
block (stylesheet rules, `isLightCssColor` luminance > 0.85). So #4028's white zebra rows
stay legible without the blanket tint. The blockquote-only tint (standalone `blockquote {}`
rule, from #2538) stays unconditional in dark mode — that's intended.

**Symptom #2 shares this root cause.** #4419 also reported "spacing between words changes"
on a vertical (writing-mode) 目录/TOC page. Those CJK web-novel books lay the TOC out as a
`<table>` with empty `<td>` spacer columns and `<span class="space">▉</span>` spacers
(custom "space" font; ▉ U+2589 is a **blank glyph, contours=0** — pure advance width, no
outline). The blanket `table *` rule paints a background on those spacer spans/cells,
making the invisible gaps show as tinted blocks → looks like the spacing changed. It's the
painted **background**, not text color, that reveals them — recoloring `.co0` (`color:#000`
→ fg) does nothing because the glyph has no outline. Gating the tint fixes both symptoms.

Tests live in `src/__tests__/utils/style-get-styles.test.ts` (assert the `blockquote,
table *` block has no `color-mix` when overrideColor false; keep the override-true and
blockquote-still-tinted cases). Related: [[css-style-fixes]].
