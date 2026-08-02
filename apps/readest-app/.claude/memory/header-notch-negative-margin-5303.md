---
name: header-notch-negative-margin-5303
description: "#5303 negative top margin now lifts SectionInfo into the notch - band geometry invariant, z-10 stacking trap, Android CDP verify gotchas (landscape insets, evaluate needs return)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 134c3ddb-35a4-4a67-95aa-a7ba0acd27d1
  modified: 2026-08-02T18:24:06.478Z
---

#5303 (MERGED PR #5447 2026-08-03, VERIFIED Xiaomi 13): negative
top margins (allowed down to `-gridInsets.top`) used to collapse the header title
band - CSS height went negative (invalid, falls back to auto) so the title stayed
below the safe area overlapping the book text while the notch strip stayed blank.

**Fix model** - `getHeaderBandGeometry(topInset, marginTopPx)` in `src/utils/insets.ts`:
`height = max(margin, 16)`, `top = max(0, topInset + min(margin, 16) - 16)`.
Invariant: band bottom == content top == `max(topInset + margin, 16)` - the same
16px floor as FoliateViewer's `moreTopInset`. Margins >= 16 are pixel-identical to
the old layout; below that the band keeps 16px height and slides into the notch.
Scrolled mode: `scrollTop` (viewport paddingTop) must reuse the floored `topMargin`,
and the notch mask clip shrinks to `min(topInset, band.bottom)`.

**Stacking trap (two-sided)**: `.notch-area` mask is `z-10`; `.sectioninfo` was
z-auto, which loses to ANY positive-z sibling regardless of DOM order - the lifted
title vanished under the opaque scrolled mask on device. But an UNCONDITIONAL z-10
broke desktop: the HeaderBar wrapper is z-auto (`fixed z-20` only under 640px), so
the bar's z-10 stacking context - including the z-20 button groups CONFINED inside
it - paints below a later z-10 sibling; the full-width band [0,44] covered the
toolbar and its hover trigger, and the web e2e reading specs timed out on CI
(Playwright log named ".sectioninfo intercepts pointer events"; repro needs
CI=1 + `pnpm build-web` - passes against `pnpm dev-web`). Fix: z-10 only when
`!isVertical && band.top < topInset` (never true on desktop, where min margin is
16). Ribbon stays `z-20` above both.

**Android CDP verify gotchas** (drove the real settings UI on-device):
- Device in LANDSCAPE -> cutout is on the side, `gridInsets.top = 0`, negative
  margins impossible (LayoutPanel min becomes 16). Force portrait first:
  `adb shell settings put system user_rotation 0` + `accelerometer_rotation 0`
  (restore after). Xiaomi 13 portrait: inset 44 css px, UI min exactly -44.
- `CdpPage.evaluate` wraps code in an async IIFE - bare expressions return
  undefined; every probe MUST `return`. waitFor "(last: undefined)" = missing return.
- vitest swallows console.log of PASSING android-lane tests; dump JSON to files.
- The fixture book's viewSettings persist across driver runs - reset margin/mode
  before taking a baseline.
- `sips -c` crops from CENTER and ignores --cropOffset; use ffmpeg `crop=w:h:0:0`.
- Settings driven by aria-label (Button sets it) + `[data-tab="Layout"]` +
  `[data-setting-id="settings.layout.pageMargins"]` first `.h-14` row; NumberInput
  buttons[0]=minus. The margin input regex rejects "-", so negatives are only
  reachable via the minus button (22 clicks from 44 to -44).

Related: [[header-trigger-band-first-line-5429]] [[reader-toolbar-touch-targets-5401]]
