---
name: body-font-size-normalize-5420
description: "MERGED PR #5422 - publisher body-copy font-size flatten gated behind Override Book Font; getFontStyles CSS only ever reaches reflowable docs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b2d2a11-dd9f-4797-af00-35206dd435ab
  modified: 2026-08-01T20:26:53.228Z
---

Issue #5420: books whose regular paragraphs carry explicit publisher sizes (repro
"Economics in One Lesson": `p.indent { font-size: small }` -> 0.875rem after
`transformStylesheet`) render all body text at 87.5% of the configured size.
PR #5422 (ChuwuYo) fixed it with `p, li, div, pre, dd { font-size:
max(1rem, var(--min-font-size, 8px)) !important }` plus
`readest-reflowable`/`readest-fixed-layout` body marker classes and 3 test files.

Maintainer rework (pushed to the PR branch, force-push over rebase):

- **Marker classes are dead weight**: `getFontStyles` output leaves `getStyles`
  only via `renderer.setStyles?.()`, and foliate's `FixedLayout` renderer has no
  `setStyles`, so the injected CSS can never reach FXL/PDF/CBZ docs. No
  per-document gating needed.
- **Unconditional flatten is too bold**: the repro book itself styles chapter
  titles as `<p class="ct">`/`<p class="chn">` with `x-large`; always-on flatten
  crushes p/div-based titles (very common in CJK/Calibre books), footnotes,
  poetry. Readium CSS ships fs_normalize as explicit opt-in for the same reason.
- **Final shape**: rule stays in `getFontStyles`, emitted only when
  `overrideFont` is true ("Override Book Font"), ~11 lines in
  `src/utils/style.ts`, no tests (maintainer explicitly wanted none).
- A measurement-based alternative (char-weighted dominant size -> scale root via
  `--fs-normalize` var, preserves hierarchy) was prototyped and rejected as too
  involved; flatten-behind-toggle chosen for minimalism.

**Why:** base font size on `html`/`body` stays always user-controlled (#267);
what is gated is discarding publisher sizing on body-copy elements.

**How to apply:** when reviewing reader CSS override PRs, check whether
`renderer.setStyles` reachability already scopes the rule before adding
marker classes; prefer gating aggressive `!important` overrides behind the
existing `overrideFont` toggle.
