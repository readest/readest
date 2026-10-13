---
name: annotations-hub-scroll-to-new-note-5987-5957
description: "#5987/#5957 new annotations invisible after Annotate — MERGED #6013; note editor moved onto the selection (popup + 60% sheet)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6cadaf05-b000-4043-9a4e-aaafa0fab6f6
  modified: 2026-09-01T14:17:43.861Z
---

**#5987 + #5957 are the same bug** (0.12.6 regression from #5928, which moved
Annotate out of the Notebook and into the sidebar annotations hub).

`Annotator.handleAnnotate` set `annotationEditTargets[bookKey]`, the matching
`BooknoteItem` got `startEditing` and its `TextEditor` autofocused. But
`BooknoteView`'s only auto-scroll target was `nearestIndex` — the note nearest
`progress.location`, and `findNearestCfi` collapses the location to the **page
start**, so a note created lower on the same page is never "nearest". The row
stayed virtualized out, the editor never mounted, and the count went up with
nothing on screen. #5957's "random position (sometimes top, sometimes bottom)"
is the same thing seen from the other side.

**Shipped fix — the editor moved to the selection, the hub was not made to
scroll.** chrox rejected the first attempt (scroll the hub to the edit target,
commit 81217e70a) in favour of this. **MERGED as #6013** (merge `6df90139d`,
2026-09-01), 6 commits:

- `AnnotationNoteEditor` — one autofocused editor, text area on top, Cancel/Save
  pinned bottom-right via `flex h-full` (the host sizes it, so the buttons don't
  float under a content-sized textarea).
- Desktop: hosted by `AnnotationPopup` as a 4th body mode (`noteEditor` prop),
  absolutely positioned off `trianglePosition.dir` exactly like
  `AnnotationNotes`. **It must repeat Popup's own chrome recipe** — `border` +
  `not-eink:border-base-content/20 not-eink:shadow-2xl` + `bg-base-300
  theme-dark:bg-base-100` — or in dark mode the card is the page's own colour
  and reads as transparent.
- Mobile (`innerWidth < 640 || innerHeight < 640`, the DictionarySheet
  heuristic): `NoteEditorSheet`, a `Dialog` with **`snapHeight={0.6}`**. Without
  snapHeight the Dialog goes full height and looks absurd for a 3-line note.
- The sidebar is untouched by Annotate now, so `annotationEditTargets` and
  BooknoteItem's `startEditing`/`placeholderIds`/`onFinishEditing` are deleted.
- **#4791 cleanup must hang off `noteEditorTarget` going away, NOT off Cancel.**
  Annotate creates an empty placeholder highlight for the note to hang on, and
  it may only outlive the editor if the note was saved. Cancel is not the only
  way the editor stops being presented: `handleDismissPopup` is also called from
  effects on `isSideBarVisible` and on relocate (page turn). Worse, the relocate
  path guards on `isTextSelected.current`, which `dropSelectionForOverlay()`
  now clears when the editor opens — so a page turn went from unreachable to
  live and left a stray highlight. Fix: `pendingNotePlaceholdersRef` + an effect
  on `noteEditorTarget`; `handleSaveNote` clears the ref first. This is what the
  pre-#5928 Notebook did (`useEffect` on `isNotebookVisible &&
  notebookNewAnnotation`). Found by CodeRabbit on PR #6013 — it was right.
- `data-testid='booknote-note-editor'` is shared with the sidebar's own inline
  editor (only one is ever open) so `ReaderPage.addNote` keeps working.
- The note bubble's pencil routes into the same editor (`onEditNote` ->
  `AnnotationNotes` -> `AnnotationNoteItem.onEdit`); `AnnotationNoteItem`'s own
  inline editor is gone.
- **Every over-the-page surface must drop the selection** (`dropSelectionForOverlay`):
  the app-drawn range handles and iOS's native highlight paint ABOVE web
  content, so a live selection under a sheet renders on top of it (#5815).
  `overlaySurfaceOpen` (was `lookupPopupOpen`) gates both range editors and now
  includes the note editor. Clear `isTextSelected.current` BEFORE `deselect()`
  or the selectionchange dismisses the surface being opened (#5585).
  Known consequence: closing the dictionary/translator no longer returns to the
  annotation toolbar.

**Ordering was never broken — visibility was.** chrox: always sort by CFI, no
recency sort, no sort toggle.

Also landed in #6013: **Insert into Notebook removed** from the annotation row
(its i18n key pruned from all 34 locales); the **hover border** killed on
`btn-ghost` icon buttons and on `TextButton` (daisyUI's `btn` keeps a 1px
border that `btn-ghost` only *colours in* on hover — `hover:bg-transparent`
never touched it, so add `hover:border-transparent`); and the two note editors
matched in anatomy and size — `.content.font-size-sm` is 0.875**em**, so an
editor must carry `.content` itself to get the responsive base (16/18.4/20px)
the sidebar row gets from `li.content`, or it renders a size smaller.

**Still unverified at merge:** the iOS grabber suppression has no device run,
and `z-[44]` reorders every reader overlay (handles now paint under the
annotation toolbar where they overlap). See
[annotator-overlay-z-layers](annotator-overlay-z-layers.md).

**How to apply:** a "my new annotation went missing / landed randomly" report
against the hub is this class of bug. Reproducing it needs a long list and a
separate port — see
[verify-annotations-hub-needs-long-list](verify-annotations-hub-needs-long-list.md).
