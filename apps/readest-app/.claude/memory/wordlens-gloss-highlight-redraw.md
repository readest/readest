---
name: wordlens-gloss-highlight-redraw
description: "Word Lens Mastered/Learning left page highlights misaligned: overlay only redraws on body resize; fix re-resolves CFIs via contentEpoch, never overlayer.redraw() (ranges collapse when a word is wrapped)"
metadata:
  node_type: memory
  type: project
  originSessionId: e49ce3b3-77b0-4ab5-8797-8a3dba05fb7e
  modified: 2026-11-18T08:45:14.361Z
---

Marking a glossed word Mastered (or Learning, or toggling Word Lens) reflows the page, but foliate's overlayer only redraws when the section body resizes (View's ResizeObserver on `doc.body`), so highlights stayed at old positions until the next page turn. Fixed 2026-11-18, MERGED #7616 (9c0d1be22): `refreshSectionGlosses` calls `ctx.onGlossesChanged` → FoliateViewer dispatches `wordlens-glosses-changed` → Annotator bumps `contentEpoch` (formerly `translationEpoch`) and re-adds the page's annotations from their CFIs.

**Why:** `overlayer.redraw()` reuses the stored live Ranges. `applyGlosses` does `extractContents` + `insertNode`, which collapses a live range that covers exactly the newly wrapped word: in the app a highlight on "girl" shrank from 29px to 4px. Re-resolving the CFI (ruby is `cfi-skip`, rt `cfi-inert`) is exact.

**How to apply:** any code that mutates section DOM after highlights are drawn should signal the Annotator's content epoch, not repaint the overlay. The footnote popup had the same gap, MERGED #7620 (521cc776e): its `onGlossesChanged` clears `drawnNotesRef` before bumping `popupContentEpoch`, because `drawPopupNote` skips notes already drawn at the same CFI and updatedAt. To test popups, build a one-chapter EPUB with an `epub:type="footnote"` aside in Python (zipfile, mimetype stored first). Repro recipe: dev-web + Playwright, serve `cdn.readest.com/wordlens/*` from a local copy via `page.route` with ACAO `*` (the CDN sends no CORS header to localhost); Alice ch.2 "ashamed" gets 惭愧的 under zh-CN. Related: [[vocabulary-builder-789-6613]].
