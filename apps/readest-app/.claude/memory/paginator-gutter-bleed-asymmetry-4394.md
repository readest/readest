---
name: paginator-gutter-bleed-asymmetry-4394
description: "Paginated page background overflowed its column into the outer --_outer-min gutter (asymmetric on mixed spreads); fix = clamp computeBackgroundSegments to the content area, keep the grid"
metadata: 
  node_type: memory
  type: project
  originSessionId: 108a70bd-5af9-4a31-9b93-9d6df7637579
---

#4394 "page viewport offset / content clipping." On a 2-up cover spread the
left page (cover `<img>`, transparent page bg) had a white outer gutter while
the right page (`<body class="c3">` body-colour yellow) bled its colour past its
column into the right outer gutter → spread looked shifted right. On a wide
screen (1920px, 720 max-inline) the gutters are ~250px so it reads as a "massive
white blank gap." 0.10.6 filled colour edge-to-edge; 0.11.2 regressed.

**Geometry.** Grid `#top` = `minmax(--_outer-min-left,1fr) margin-left
minmax(0,maxw) margin-right minmax(--_outer-min-right,1fr)` (foliate
`paginator.js`). `#container` = grid-column 2/5 (inset by the outer gutter
tracks); `#background` = grid-column 1/-1 (spans the gutters). `--_outer-min =
(col_count-1)*(margin/4 + gap/4)` — non-zero ONLY in multi-column (0 in
1-column), added in commit `0a0ceda` so the outer margin matches half the
inter-column gap (symmetric spacing). `inset = containerLeft - bgLeft =
--_outer-min-left`.

**Cause.** `computeBackgroundSegments` (the swipe-flash fix, commit `167757a`)
positioned each page's colour segment at `inset + offset - scrollPos` and then
STRETCHED any segment touching a container edge OUT to the bg edge (`start=0` /
`end=bgSize`) — i.e. bled into the outer gutter. A body-coloured page bled into
its gutter; a transparent/image page (cover) did not (its `#background` is
transparent; its `<img>` is clamped inside the inset `#container`). Mixed spread
→ one gutter coloured, one not → asymmetric.

**Fix (what the maintainer wanted).** Do NOT touch `--_outer-min` (it keeps the
left/right margins symmetric with the centre gap). Instead CLAMP each segment to
the content area so the background stays inside its column and never overflows
into the outer gutter:
```js
const start = Math.max(segStart, containerStart)   // was: if(...) start = 0
const end   = Math.min(segEnd,   containerEnd)      // was: if(...) end = bgSize
if (end <= start) continue
```
`containerStart=inset`, `containerEnd=inset+containerSize`. In single-column the
gutters are 0 (`--_outer-min`=0 → inset 0) so this still fills the viewport edge
to edge (matches 0.10.6); in multi-column each page stays in its column with
symmetric gutter margins. Image pages (cover/彩页) were already correct (`<img>`
sits in its column); only the body-colour `#background` overflow needed fixing.

**Dead ends (took 2 wrong tries before the maintainer steered me right).**
1. Thought it was the gutter-bleed and "gated" the stretch on both-edges-coloured
   — maintainer: "nothing to do with the gutter" (meaning don't change the bleed
   GATING, the real issue is the offset).
2. Thought the title page shouldn't be yellow at all — it genuinely is
   `.c3{background:#ffe43f}` on `<body>`, captured as `docBackground` and painted
   full-bleed (body is zeroed via `doc.body.style.background='none'`, the old
   f087826 "dismiss iframe background, paint via root" design). Yellow is correct,
   it was just overflowing.
3. Proposed dropping `--_outer-min` (revert `0a0ceda`) — maintainer rejected:
   that desymmetrises the centre-vs-side gaps. Keep the grid; fix the background.

**Verifying live.** foliate-js is a submodule; `next dev` / turbopack did NOT
hot-reload an edit to `packages/foliate-js/paginator.js` even across full
navigations — had to RESTART the dev server (`pnpm dev-web`, port 3000) to pick
it up. Cheap interim check: clamp the live `#background` segment divs in the page
and screenshot. Segment colours are render-timing dependent (a probe right after
nav can show all-transparent before the body-colour is captured).

Tests: `apps/readest-app/src/__tests__/document/paginator-background-segments.test.ts`
(tests "centered page" + "two-up spread" flipped from full-bleed to confined; the
inset=0 swipe-flash tests are unchanged). Related: [[paginator-swipe-bg-flash]]
[[paginated-texture-occlusion-4399]].
