---
name: reading-ruler-resize-anchor-5491
description: "#5491 reading ruler loses text anchor on resize/repagination — DOM Range anchor fix, caretRangeFromPoint capture gotchas, reflow-vs-page-turn detection"
metadata: 
  node_type: memory
  type: project
  originSessionId: e57a53b4-b6a7-44c2-a03e-c7c3283b4109
  modified: 2026-08-05T15:43:23.535Z
---

Issue #5491: in paginated mode, resizing the window repaginates and the reading
ruler drifted to a different passage. MERGED via PR #5519 (2026-08-05; branch
built off origin/main via the temp-index technique from
[[ci-pr-delivery-and-push]]; the same commit also landed on local `dev` as
0ba64be87). Tests + Chrome-verified. Related: [[reading-ruler-line-aware]].

Root cause (two layers):
- A resize makes foliate `render()` → `#scrollToAnchor(#anchor)` → relocate with
  reason `'anchor'`, but view.js DROPS `reason` from `lastLocation`, so Readest's
  `progress.location` (CFI) just changes and ReadingRuler's auto-move effect
  treated it as a page turn → snapped band to first/last line group (direction
  from a fraction comparison that is noise across a reflow).
- The `!locationChanged` re-snap reconstructed the block from the band's screen
  position (`center - bandSize/2 + padding`); when the band-size cap
  (`maxBandSize`) kicks in this reconstruction is WRONG and drifts forward one
  line per relayout even without location change (seen in jsdom: 37% → 47%).

Fix (ReadingRuler.tsx + readingRuler.ts):
- `anchorRangeRef`: one-character DOM Range on the band's block-start text,
  captured after every `applyBlock` via `caretRangeFromPoint` (fallback
  `caretPositionFromPoint`). Section DOM survives repagination (CSS columns
  re-layout only), so the Range keeps tracking the text.
- Resolve = map anchor rects via frame offset → if center on-screen, snap to the
  containing line: pure helpers `snapReadingRulerToAnchor` /
  `snapReadingRulerColumnsToAnchor` (nearest-line tolerance = half median line
  height; nearest column for gutter hits).
- Reflow vs page turn: paginated foliate turns are ALWAYS whole spreads
  (`#scrollToPage(page ± 1)`), so "anchor still visible after relocate" reliably
  means reflow → re-attach; off-screen → real turn → existing auto-move. Scrolled
  mode untouched (own placement rules, #4386).
- Anchor hygiene: cleared on the no-geometry fallback paths (else a stale range
  yanks the band back later); recaptured on drag end.

**GOTCHA (drag capture):** a dragged band is not line-aligned; probing at
`blockStart + 10px` can hit the paragraph gap and `caretRangeFromPoint` returns
the PREVIOUS line's caret (band re-attached 2 lines up in live testing). Refine
to the first cached line box the band covers before probing
(`captureAnchorAtCurrent`).

**GOTCHA (caret capture):** caret in margins returns a collapsed element-node
range with no client rects — require `nodeType === TEXT_NODE` and expand to one
character, probing cross-axis fractions [0.5, 0.3, 0.7] of the active column.

Verification notes: toggling the SIDEBAR is an easy live repro of the exact
resize code path (container resize → repagination → relocate) when
`resize_window` won't take (macOS tiled window). When the anchored passage
reflows off the page (shrink pushes it past the page break), fallback = old
auto-move behavior; the re-established anchor then holds on later resizes.
Band placements animate 0.6s — screenshot too early looks like a wrong
mid-flight position spanning columns.
