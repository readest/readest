---
name: stale-format-gates-in-settings
description: Feature gates written when a format was unsupported outlive the support landing — audit them; Settings > Behavior > Scroll was disabled for PDF/CBZ long after scrolled FXL shipped
metadata: 
  node_type: memory
  originSessionId: 3d6ec81b-0f3c-4332-8d55-a61f290536eb
  modified: 2026-08-10T17:56:47.278Z
---

Recurring bug class, hit twice on 2026-08-07: a `disabled={...format...}` written when a
format genuinely wasn't supported stays behind after support lands, because the feature work
happens in the renderer and the settings row is never revisited.

- **Proofread**: `format !== 'EPUB'` — see [[proofread-gate-reflowable-formats]].
- **Scrolled Mode** (`ControlPanel.tsx`, Settings > Behavior > Scroll):
  `disabled={bookData?.isFixedLayout}` survived the whole scrolled-fixed-layout effort
  ([[pdf-scroll-lag-preload-4795]] preload scheduler, [[scrolled-pdf-pinch-zoom-4817]] live
  pinch-zoom, Webtoon Mode). Gate removed 2026-08-07; Chrome-verified on a PDF — the toggle
  enables continuous scroll and turns back off cleanly.

**The tell in both cases**: another entry point to the same feature was never gated, so the
capability was reachable and being actively developed while the settings row said no. For
scroll it is the view menu's Zoom Mode row (Vertical / Horizontal Scrolling buttons, and
Webtoon Mode force-enables `scrolled`); the plain "Scrolled Mode" menu item is hidden for
fixed layout precisely *because* that row covers it. When you find a format gate, check
whether a sibling surface already ignores it before assuming it's load-bearing.

The inverse also happens: a gate that exists on one surface and was never added
to its sibling. Settings > Language > Enable Translation had no availability
check while the toolbar's toggler always had one — see
[[pdf-translation-quota-toast-5600]].

Still inert for fixed-layout scrolled mode (left alone, not gated): "Single Section Scroll"
and "Overlap Pixels" are `paginator.js` attributes (`no-continuous-scroll`, overlap) that
`fixed-layout.js` doesn't read. "Hide Scrollbar" is CSS and does apply.
