---
name: footnote-popup-toolbar-overlap-6390
description: "#6390 highlighted footnote link opened toolbar + footnote popup stacked on one side; MERGED #6514 (e75a80e62) UNRELEASED; sibling #6504 = popup range edit + note editor, MERGED #6510"
metadata:
  node_type: memory
  type: project
  originSessionId: 333348ab-bd51-4d88-aa97-a04a8800f0c4
  modified: 2026-09-30T17:52:09.667Z
---

**#6390**: tapping a highlight that is also a footnote link opens both the highlight toolbar (with its style strip and handles) and the FootnotePopup. Both pick their side with `getPosition`'s "roomier side", so they stacked and the toolbar hid the popup's header. The issue asked for a close button and drag handle; chrox chose "both, no overlap" instead.

**Fix, MERGED #6514 (e75a80e62, 2026-09-30), UNRELEASED:**
- FootnotePopup sends its side (`footnote-popup-anchor`). `getPosition(..., avoidDir)` makes the toolbar take the free side.
- `placeToolbar` falls back to sharing the side when the toolbar and strip don't fit, or when a selection with one end off-screen lands on the taken side anyway. Annotator then sends its size (`annotation-toolbar-block`), and FootnotePopup shifts its anchor past the toolbar and refits.
- FootnotePopup keeps the shift until it closes and ignores the null update when the toolbar goes away, so the popup never moves under a selection being made inside it.
- Verified in Chrome only: web build, the Holy Bible EPUB, and top, upper, middle and bottom positions. Not tested on a phone or iOS.

**Sibling #6504** (MERGED #6510): range handles for highlights inside the popup, a live drag preview, the popup surviving the note editor (Android keyboard resize, width-only dismiss), and the note sheet resting on the keyboard. See [[android-keyboard-adjustpan-sheet-6390]]. #6510 was titled for #6390 by mistake and retargeted to #6504; the first commit message still says "closes #6390" (chrox: skip).

**Why:** the Bible EPUB has dense footnote links, so highlighted links are common.
**How to apply:** the AnnotatorLookupSurfaces harness never shows the toolbar after `onShowAnnotation`, because `handleUpToPopup` is mocked and something else keeps it closed. Don't burn time on it; test through pure helpers in sel.ts plus Chrome instead.
