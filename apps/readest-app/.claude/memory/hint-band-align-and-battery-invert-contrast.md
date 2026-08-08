---
name: hint-band-align-and-battery-invert-contrast
description: "Reader chrome must take geometry from getHeaderBandGeometry (not a fixed 44px strip) and contrast from base-content (not an invert() filter)"
metadata:
  node_type: memory
  type: project
---

Two page-chrome traps fixed together on 2026-08-07 (dev branch, from user screenshots).

**HintInfo drifted below the section title.** `HintInfo` pinned itself to `top: topInset` +
`h-[44px]` while `SectionInfo` derives its band from
`getHeaderBandGeometry(topInset, marginTopPx)` (see [[../../src/utils/insets.ts]] and #5303).
They only coincide at the *default* 44px top margin — at 32px the title centered at y8-24 and
the hint at y14-30. Fix: `HintInfo` computes the same band, using
`contentInsets.top - gridInsets.top` as the margin (equals `getViewInsets().top`, so it also
covers the compact margin used when Show Header is off, and the deprecated `marginPx`).
**Rule: anything painted in the header band takes its top/height from `getHeaderBandGeometry`.**

**Battery percentage was invisible on light themes.** `0e125b156` ("unified info bar font
style", #5045) deleted the explicit `text-black`/`text-base-300` + blend classes from the
percentage span and left only Tailwind `invert`. `invert` flips *the theme's own text color*,
not the backdrop — so the number always renders ~the page tone it sits on. Measured WCAG on
the fill (`currentColor` @ 0.3 over `base-100`): every theme was 1.0-2.8:1; `text-base-content`
gives 3.3-9.2:1 on the fill and 5-18:1 on the empty part. Eink keeps a knockout (`text-base-100`)
because its fill is opaque `base-content`.
**Rule: pick a themed color for contrast; `invert`/`mix-blend` on chrome text is how these keep
regressing.** Both still fail if the fill is narrow (low battery) — pre-existing, not worth code.

Verified in Chrome against `pnpm dev-web` (see [[browser-verify-readest-web-recipe]]): the hint
element is always mounted with an empty `h2`, so setting `h2.textContent` shows it without
dispatching the `hint` event (the `eventDispatcher` is a module singleton, unreachable from the
page). Tests: `src/__tests__/app/reader/components/{HintInfo,StatusInfo}.test.tsx` — HintInfo's
renders the real `SectionInfo` alongside it and asserts the two bands match.
