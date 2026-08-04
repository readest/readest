---
name: image-viewer-alt-caption-5232
description: "#5232 image viewer shows the book's own image description (img alt / svg title); MERGED #5472"
metadata:
  node_type: memory
  type: project
---

MERGED #5472 (2026-08-03). EPUBs often keep an illustration's caption or table description in the `img` `alt` attribute rather than a `<figcaption>`, and it was invisible once the image opened full screen.

Where the description lives, by markup shape: `<img alt>` for plain images, the SVG **`<title>`** for `<svg><image/></svg>` wrappers (very common for full-page illustrations and covers). Whitespace-only alt counts as none. Both are read in `collectDocumentImages()` in `src/app/reader/utils/documentImages.ts`, extracted from the inline loop that used to live in `FoliateViewer.handleImagePress`.

Two non-obvious bits:

- The caption is its **own** state (`selectedImageAlt`) next to `selectedImage`, NOT derived from `imageList[currentImageIndex]`. When the tapped image is not found in the list, the index falls back to `0`, so a derived caption would silently label the image with a *different* image's description. Any future change here must keep the two updated together across open / prev / next / close.
- The zoomed `<img>` carries `role='none'` (presentation), so the `alt` is **not** an accessible name no matter what you put in it. Screen readers get the description from the visible `.image-caption` text node instead. Do not "fix" a11y by only touching `alt`.

UI rule that drove the design: the caption does not share the zoom badge's 2s auto-hide, because it is content rather than chrome. Tapping the image toggles it off the artwork (`showCaption`, flipped in the same handler as `showZoomLabel`). It renders as a **sibling** of the click-to-close container so reading or scrolling a long description never dismisses the viewer, uses `dir='auto'` (book language != UI language), and is offset by the bottom inset.

Local browser verification needs a purpose-built EPUB (the `sample-alice.epub` fixture has no alt-bearing inline figures) and the worktree port trap in [[web-e2e-local-devserver-cold-compile-flake]]. Related: [[invert-img-dark-override-5250]].
