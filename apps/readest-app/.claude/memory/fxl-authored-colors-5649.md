---
name: fxl-authored-colors-5649
description: "#5649 fixed-layout EPUB text followed the theme; two paths (linked text/css transform + color-scheme dark) plus the page-background interaction that forces the 'render as authored' policy"
metadata: 
  node_type: memory
  type: project
  originSessionId: 99a6e459-30e9-447f-861f-43198ba11b06
  modified: 2026-08-12T16:52:41.948Z
---

#5649 (fixed-layout EPUB text turns theme-colored in dark mode) — MERGED as #5657
(merge commit `437bcf9fd`) on 2026-08-13. Device verify pending on a real FXL book.

Fixed-layout EPUB docs receive **only** `applyFixedlayoutStyles`: foliate's
fixed-layout renderer has no `setStyles`, so `getStyles`/`getColorStyles` (and all its
`*[style*="color:#000"]` overrides) never reach them. That makes `applyFixedlayoutStyles`
the single lever for FXL page colors.

Two independent causes, both verified live in Chrome with a hand-built repro EPUB
(reporter's attachment was a corrupt zip):
1. `FoliateViewer.getDocTransformHandler` ran `transformStylesheet` on every `text/css`
   resource with no fixed-layout gate, so authored `color:#000` became
   `var(--theme-fg-color)` — wrong in light/sepia too (rendered brown), not just dark.
   `services/transformers/style.ts` (inline `<style>`) already had the gate; the resource
   path did not. The same transform also rescales FXL font sizes (`/1.25` on mobile),
   resolves vw/vh against the reader viewport, and rewrites `font-family: serif` to
   `unset`.
2. `applyFixedlayoutStyles` set `color-scheme: dark` with no explicit `color`, so text the
   book never colored fell back to the UA dark default (white) — theme-independent.

**The load-bearing third piece:** `body { background-color: var(--theme-bg-color) }` in the
same function paints the theme color over the FXL *page* (each FXL page is its own iframe;
letterboxing lives outside it). Fixing 1+2 alone leaves authored-black text on a
theme-dark page = illegible. So the fix must also stop painting the page. Gate:
`appRendered = !format || FIXED_LAYOUT_FORMATS.has(format)` (PDF/CBZ keep theme bg +
`color-scheme: dark`; EPUB gets `color-scheme: light` and no bg). With the bg rule gone the
iframe base background renders the page white — verified, no transparent-shows-dark trap.

Known trade-offs, both accepted: FXL EPUB pages now render authored-white in dark/sepia
(matches Apple Books), and FXL linked CSS keeps `user-select: none` since nothing rewrites
it anymore (inline `<style>` already behaved that way).

See [[browser-verify-readest-web-recipe]] for the drag-drop import + shadow-DOM walk used
to verify; [[stale-format-gates-in-settings]] for other format-gated behavior.
