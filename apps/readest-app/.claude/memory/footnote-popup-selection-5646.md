---
name: footnote-popup-selection-5646
description: "#5646 annotation toolbar in footnote popups (SHIPPED #5744): CFI splice-mapping over foliate's extractContents, Path A/B split, review fixes, known gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: b67c2418-b554-4ed1-a5cb-02b252267004
  modified: 2026-08-16T13:10:29.425Z
---

Feature #5646 (select/highlight inside footnote popups) implemented 2026-08-16, Chrome-verified. SHIPPED: app PR #5744 MERGED 2026-08-16 as 631cd6454; foliate#77 MERGED as 57c9358. Worktree + both branches deleted.

**Delivery:** two-repo change - foliate fork PR first (#77), then the app PR carrying the submodule bump to the squash SHA. Both squash-merged, so local branch tips were never ancestors of main; verify by content diff over the touched paths, not `merge-base --is-ancestor`.

**The CFI trick:** foliate's `FootnoteHandler#showFragment` does `range.extractContents()` + `body.replaceChildren(frag)`, destroying CFI parity. But CFI child steps depend only on the count of preceding ELEMENT siblings (elements even indices, text chunks odd), so for element-aligned single-container ranges every first-level index shifts by a constant `delta = 2 * elementsBeforeStart` and deeper steps are untouched. footnotes.js now computes `{containerCfi, delta, firstIndex, lastIndex}` pre-extraction (`getExtractMapping`, exported) and puts it + `index` on the `render` detail; `src/app/reader/utils/footnoteCfi.ts` splices popup paths onto the container path (forward) and back (reverse, bounds-checked by first/lastIndex). Start boundary splitting a text chunk = unmappable (returns null -> tools disabled). epubcfi.js now exports `toString` and `buildRange`.

**Path A vs B:** real footnote popups (foliate view) get mapped CFIs -> highlight/annotate/copylink/proofread work; saved booknote resolves in the pristine main doc (id assertions like `[n2_8_2]` make it robust). Alt/data-attribute popups (`handleFootnotePopupEvent`, host-doc `<p>`) dispatch selections with `cfi: undefined` -> those tools disabled; copy/search/dictionary/translate stay enabled. TTS disabled for ALL popup selections (reads main-view docs).

**Wiring:** FootnotePopup attaches selectionchange (250ms debounce) + pointerup to the popup doc, dispatches `footnote-selection` events (no range = cleared); Annotator listens, sets `selection.popup = true` (new `TextSelection.popup` field). Popup overlay sync = FootnotePopup subscribes to `booksData[hash].config.booknotes` and add/removes overlays with reverse-mapped local CFIs (draw styling shared via `drawAnnotationOverlay` extracted from Annotator into annotatorUtil). Annotator moved AFTER FootnotePopup in BooksGrid so the toolbar (z-50) stacks above the popup + dismiss overlay - both use z-50, DOM order decides.

**Clicking a drawn popup highlight** opens the toolbar in annotated state (user-requested follow-up, in the amended commit): FootnotePopup listens `show-annotation` on the popup view, reverse-looks-up the booknote id via drawnNotesRef (local value -> id), dispatches `footnote-selection` with `annotated: true` + the BOOK cfi; Annotator sets an annotated selection (Delete Highlight + style options) but never `setEditingAnnotation` - range-edit handles only work on main-view docs.

**Note merge (user-reported round 2):** Notebook.handleSaveNote recomputed `view.getCFI(selection.index, selection.range)` from the MAIN view - for a popup range that yields a bogus CFI, missing findAnnotationAtCfi and FORKING a second record. Fixed with the same `selection.popup ? selection.cfi : ...` pattern; grep for `getCFI(selection` when touching selection consumers. Popup sync now also draws the note BUBBLE overlay (`NOTE_PREFIX + localCfi`, drawn map key `id#note`); deleting the record removes both.

**Overlay click ambiguity (pre-existing, app-wide):** a unified record's highlight and bubble overlays share the same range rects; Overlayer.hitTest picks by reverse insertion order, and view.addAnnotation is async, so WHICH overlay a click reports is racy in main view AND popup alike. Popup behavior matches main view; deterministic bubble priority would be a separate app-wide fix.

**CodeRabbit review (b182f8d1a, all 8 findings fixed):** stale-async epoch guard on `onFootnoteSelection` (every event for the book bumps it, checked after each `getAnnotationText` await); `handleAnnotate` + copy-to-notebook toast guarded for CFI-less popup selections; `normalizeBoundary` generalized to EVERY element container (CFI drops offsets on even element steps - descend to the equivalent text position; returning null as the reviewer proposed would kill select-all); section pre-filter in the sync effect via `getCfiSpinePrefix` with id assertions STRIPPED (raw string prefix compare is fragile - imported CFIs spell assertions differently); `resetPopupAnnotationState` helper; host-path `pointerup`; `popupView` rename (kept `getCFI` on the popup view - same BookDoc, and it owns `index`); tests assert resolved node+offsets and both null paths.

**Known gaps / follow-ups:** selecting (not clicking) already-highlighted popup text still shows "Highlight" not "Delete Highlight" (clicking the button still toggles-deletes correctly); annotation quick actions bypassed in popups (toolbar always shows); dictionary-close returns to dismiss, not toolbar (#5213 behavior main-view only); element-container selection boundaries lose child offsets in CFI serialization (pre-existing foliate limitation, body-level boundaries normalized by descending into text). The user's library may contain one mis-anchored note record from their pre-fix testing (duplicate "God created the earth..." note) - deletable from the sidebar.

Tests: `src/__tests__/utils/footnote-cfi-mapping.test.ts` (8 round-trip/rejection cases, imports getExtractMapping from the fork).
