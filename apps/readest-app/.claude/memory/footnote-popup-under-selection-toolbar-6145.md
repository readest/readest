---
name: footnote-popup-under-selection-toolbar-6145
description: "#6145 selection toolbar hid behind the footnote popup — regression from #6036's z-[43] toolbar band; fix = give FootnotePopup its own z-[42] wrapper"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8837c1f9-62f9-4223-8a74-1decadf40b05
  modified: 2026-09-08T08:51:20.263Z
---

Reported 2026-09-08 on 0.12.8 (Windows): tap a footnote, double-tap a word
inside the popup, and the selection toolbar opens *behind* the note — the
dictionary button is neither visible nor tappable.

**Root cause: a regression from #6036.** `BooksGrid` mounts `FootnotePopup`
before `Annotator` precisely so the toolbar would win the DOM-order tie while
both surfaces sat at `z-50` (there was a comment saying so). #6036 moved the
toolbar into its own `z-[43]` band (below the range handles, see
[[annotator-overlay-z-layers]]), so DOM order stopped deciding anything and the
footnote popup's `z-50` buried it.

**Fix** (`FootnotePopup.tsx`): wrap its `<Popup>` in
`<div className='pointer-events-none absolute inset-0 z-[42]'>` and give the
popup `pointer-events-auto` — the same stacking-context trick #6036 used on
`AnnotationPopup`. `absolute`, never `fixed`: the popup's coordinates are
book-cell relative and the cell is the `relative` ancestor, so insetting to the
cell makes the context without moving anything; `pointer-events-none` keeps the
cell-covering wrapper from eating the taps the dismiss `Overlay` needs.

**The band model this settles:** a surface whose *text can be selected* (the
book page, the footnote popup) belongs BELOW the selection band — toolbar
`z-[43]`, handles `z-[44]`. A surface opened *from* the toolbar (dictionary,
translator, note editor) stays at `z-50`, above both. Reader chrome in the cell
(header/footer/navs) tops out at `z-20`, so `z-[42]` still covers it, and the
sidebar/notebook `z-[45]` is unreachable while the footnote's full-screen
dismiss overlay is up.

**How to apply:** never let reader-overlay order rest on DOM order — #6036 and
#6145 are the same lesson twice. When a new band is introduced, re-check every
surface that used to tie with it at `z-50`.

Regression test: `src/__tests__/app/reader/components/footnote-popup-toolbar-stacking.browser.test.tsx`
renders `FootnotePopup` + the real `AnnotationPopup` in BooksGrid's order and
(a) hit-tests the overlap with `elementFromPoint` and (b) pins
`layerOf(footnote) < layerOf(toolbar)` off computed styles. Both failed before
the fix. `pnpm test` (11069) + `pnpm test:browser` (463) + `pnpm lint` green;
Verified live in Chrome on the reporter's own book (Chinese editor's-note
footnote in 黄仁勋：英伟达之芯) — the user confirmed the toolbar now draws on top.
MERGED #6146 as ef234c5bb (2026-09-08), UNRELEASED.
