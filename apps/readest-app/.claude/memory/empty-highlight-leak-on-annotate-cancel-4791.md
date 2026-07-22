---
name: empty-highlight-leak-on-annotate-cancel-4791
description: Annotate eagerly creates a highlight placeholder; cancelling the note must tear it down
metadata: 
  node_type: memory
  type: project
  originSessionId: 1c75c865-8e1b-4641-ac20-81692d3ff20b
---

#4791 — clicking **Annotate** on a selection eagerly creates a highlight (`note:''`)
as the note anchor (`handleAnnotate` → `handleHighlight(true)` in `Annotator.tsx`),
so the selection stays visible while the NoteEditor is open. Cancelling the note
(Cancel button, overlay, Escape, switching books, closing the notebook) left that
empty highlight leaked into config → showed as a stale card in the left-sidebar
Booknotes list + a phantom yellow highlight.

**Fix:**
- `handleHighlight` now returns the created `BookNote` only when it pushes a NEW
  record (returns `null` when it restyles/toggles an EXISTING one — that record
  predates the flow and must survive a cancel).
- `handleAnnotate` stores `created?.id` via `setNotebookNewHighlightId` (new
  `notebookStore` field). This tracked id is what distinguishes a removable
  placeholder from a pre-existing highlight; do NOT identify it by cfi (a fresh
  selection can collide with an existing highlight's cfi).
- `removeEmptyAnnotationPlaceholder(booknotes, id, now)` in `annotatorUtil.ts`
  tombstones (`deletedAt`) the live annotation with that id ONLY if it still has
  no note text, and returns it so the caller tears the overlay down with
  `removeBookNoteOverlays` across ALL views (`getViewsById`, symmetric with how
  `handleHighlight` drew it).
- Cleanup is **presentation-driven**, not threaded through every cancel path:
  `Notebook.tsx` runs `handleCancelNewAnnotation` from an effect whenever the
  creation editor stops being presented (`!(isNotebookVisible && notebookNewAnnotation)`)
  — catches Cancel/Escape/overlay/close/swipe/navigate — plus a second effect's
  cleanup on `sideBarBookKey` change / unmount for book-switch (pinned) and
  reader-close.
- Save survives the guard (placeholder gains note text) and also clears the
  tracked id. `handleCancelNewAnnotation` has stable identity (empty deps) so the
  effects don't re-fire mid-edit; it reads settings fresh via
  `useSettingsStore.getState().settings` (stale-closure guard, see [[webdav-connect-nullified-4780]]).

**Why id-set-LAST in handleAnnotate matters:** `setNotebookNewHighlightId` is
called after `setNotebookVisible(true)` + `setNotebookNewAnnotation`, so no
intermediate render has (editing=false AND a fresh placeholder id) — prevents the
presentation effect from deleting the placeholder it just created.

Related: [[instant-highlight-delete-orphan-4773]], [[customize-toolbar-global-serializeconfig]].
