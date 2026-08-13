---
name: fxl-chrome-android-text-autosizing-5641
description: "#5641 Chrome-for-Android TextAutosizer opens gaps in per-letter absolutely-positioned FXL text; fix = text-size-adjust none in applyFixedlayoutStyles (PR #5659)"
metadata: 
  node_type: memory
  type: project
  originSessionId: e9c76d4f-562d-4c1b-9e16-c636b8859493
  modified: 2026-08-12T17:23:43.607Z
---

#5641 (spurious tab-sized gap inside words of InDesign comic-style FXL EPUBs, Chrome
for Android only, native app + web) — MERGED #5659 (merge `42c7a2cb0`) on 2026-08-13;
worktree + branches cleaned up. Desktop-Chrome live verify was started then cut short
by the merge — and desktop Chrome has no TextAutosizer anyway, so the only meaningful
check left is on an Android device/Chrome-for-Android build: verify PENDING. Repro
book: issue attachment `real-excerpt-repro.zip` is an UNPACKED epub — repack with
`zip -X0 book.epub mimetype && zip -rX9 book.epub META-INF OEBPS` before importing.

Root cause (diagnosed by reporter SiggeMcKvack, verified in code): Blink's
`TextAutosizer` ("font boosting", Chrome-for-Android only) rescales line metrics on
pages it judges not mobile-optimized. InDesign FXL exports position every letter as
its own `position: absolute` span inside a `transform: scale()` container; a letter
with a nudged `top` (descender/diacritic baseline adjustment) gets boosted into a
separate cluster and drifts, opening a gap mid-word.

Why only FXL: reflowable books get `-webkit-text-size-adjust: none` via
`getFontStyles` → `renderer.setStyles`, but the fixed-layout renderer has no
`setStyles` — FXL docs receive ONLY `applyFixedlayoutStyles` (see
[[fxl-authored-colors-5649]], same single-lever fact). Fix: add
`-webkit-text-size-adjust: none; text-size-adjust: none` to the `html` block of the
stylesheet `applyFixedlayoutStyles` injects (`src/utils/style.ts`); unconditional,
harmless for PDF/CBZ (app-rendered images). Test in
`src/__tests__/utils/fixed-layout-styles.test.ts` (match unprefixed with
`/[^-]text-size-adjust/` — plain `toContain` also matches the -webkit- one).

Field-diagnostic worth reusing: Chrome's "Desktop site" toggle suppresses the
mobile autosizing heuristics — if a text-layout glitch disappears with Desktop site
on (and GPU-raster flags change nothing), it's TextAutosizer. Reporter's repro
sample: real-excerpt-repro.zip attached on the issue.
