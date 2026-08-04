---
name: library-search-history-mask-fade-5488
description: "PR #5488 library search history chips over background textures - translucent bg-base-300/45 like the input, scroll edge fades must be mask-image on the container (painted from-base-200 overlays smear over images); reader sidebar SearchBar still uses old pattern"
metadata: 
  node_type: memory
  type: project
  originSessionId: b25fa0d9-2e12-45ae-98df-a486d7b7c801
  modified: 2026-08-04T08:24:43.404Z
---

PR #5488 (MERGED 2026-08-04): with a library background texture, the search history chips (`src/app/library/page.tsx`) were opaque `bg-base-100` pills and the two absolutely-positioned `from-base-200` gradient fade divs painted a visible smear over the image (worst right before the clear X).

Fix pattern (reusable wherever scroll-edge fades sit on a texture/image background):

- Chips match the search input exactly: `bg-base-300/45 hover:bg-base-300/70` (input is `bg-base-300/45` in LibraryHeader).
- Edge fades = `mask-image` on the scroll container itself, NOT painted gradient overlays: `not-eink:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%_-_12px),transparent)]`. The mask dissolves the chips; overlays paint theme color on top of whatever is behind.
- Keep the mask SYMMETRIC: CSS gradients have no logical (start/end) direction, so an asymmetric `to right` mask puts the wider fade on the wrong side in RTL. 12px each edge preserved the first chip's rounded cap better than 24px.
- Tailwind 3.4 arbitrary property + custom `not-eink` variant compiles fine; autoprefixer (in postcss.config) emits `-webkit-mask-image`, so no manual prefix class.
- `eink:hidden` on the old overlays maps to `not-eink:` gating the mask.

Still using the old painted-overlay pattern: reader sidebar `src/app/reader/components/sidebar/SearchBar.tsx` (~line 400) - fine there because the sidebar is always solid base-200, but it will smear if that panel ever gets textures.

Verification: CDP live-preview on the Xiaomi (see [[android-cdp-e2e-lane]] recipe - suppress_origin, classList toggle of classes already in the shipped bundle, inline-style the mask) plus Chrome against dev-web with `localStorage['search-history-library']` seeded; history row only renders when `librarySearchTarget === 'text'` (`/library?search=text`, but the [[library-then-by-sort-order-5119]] URL cleanup strips it and falls back to the stored target - toggle via the search bar's leading icon).
