---
name: overlayer-blend-mode-follows-page-not-theme-5790
description: "PDF highlights invisible in dark mode - the overlay blend mode must follow the page background, not the app theme"
metadata: 
  node_type: memory
  type: project
  originSessionId: b7859dd0-d05e-4c88-923c-e4ec4364a640
  modified: 2026-09-05T08:55:47.492Z
---

#5790 / #5930 / #5943 were one bug: in a dark theme a PDF highlight painted no
band, only tinting the glyphs (yellow read as olive, blue as invisible). The TTS
read-along highlight vanished the same way, which is why #5943 was filed as a
feature request. PDF only; EPUB never reproduced. MERGED #6066 as 53c0c1686 on
2026-09-05; all three issues auto-closed.

**Root cause:** `useTheme.ts` picked `--overlayer-highlight-blend-mode` from the
app theme alone (`isDarkMode ? 'screen' : 'multiply'`). `screen` is right only
for a page that is actually dark. Reflowable books qualify because we repaint
their background in the theme colors; a pre-paginated page keeps the book's own
bitmap. `applyThemeToPDF` and `invertImgColorInDark` both default to **false**,
so a PDF in dark mode is still a white page, and `screen` over white is a no-op
on the background (`1-(1-1)(1-Cs) = 1`), leaving only the glyphs lightened.

**How to apply:** the fix is `getOverlayerBlendMode()` in `src/utils/style.ts`,
the single decision used by both the global default in `useTheme` and a per-view
override that `FoliateViewer` sets on `containerRef` (custom properties cascade
into the foliate-view shadow DOM, so the library and other routes keep the
global value). When touching highlight compositing, ask "is the page behind this
actually dark?", never "is the app in dark mode?". B&W e-ink keeps its
`difference` mask ahead of both branches.

Apple platforms never showed it, see
[[platform-compat-fixes]] on mix-blend-mode not crossing the iframe boundary in
WebKit. Related: [[eink-highlight-difference-mask-5667]],
[[annotator-reader-fixes]].
