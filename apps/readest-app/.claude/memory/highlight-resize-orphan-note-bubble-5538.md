---
name: highlight-resize-orphan-note-bubble-5538
description: "#5538 resizing a noted highlight left an orphan note bubble per edit; both overlays of a unified record are keyed by cfi and both must be re-anchored"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0dba721b-b7cb-42d4-8240-34a5f3afd221
  modified: 2026-08-06T14:56:49.017Z
---

Issue #5538 ("expanding/shrinking a highlight creates a duplicate note"). MERGED 2026-08-06
via PR #5541 (merge commit `0254e13a4`); worktree and branch cleaned up.

The BookNote record was never duplicated — the *overlays* were. A unified record draws two
overlays, both keyed by its cfi: the highlight (`value = cfi`) and the note bubble
(`value = ${NOTE_PREFIX}${cfi}`). `applyAnnotationRange` in
`src/app/reader/hooks/useAnnotationEditor.ts` tore down only the highlight; the progress-sync
effect in `Annotator.tsx` (~line 1056) then drew a fresh bubble at the new cfi. So every
boundary adjustment left one more dead bubble at the previous anchor. The orphans are
unclickable: `onShowAnnotation` looks the record up by exact cfi and finds nothing.

Fix = `removeBookNoteOverlays(view, prev)` (already existed in `annotatorUtil.ts`) instead of
`addAnnotation(prev, true)`, plus an explicit re-add of the bubble at the new cfi so it tracks
the drag live like the highlight does.

**Why bubbles look like one when they aren't:** `Overlayer.bubble` anchors to
`rects[0].right` — the right edge of the range's FIRST line box. Moving only the *end* handle
inside the same first line leaves every orphan stacked at identical coordinates. Shrink the
range so the first line box ends earlier (or move the start handle) to make them separate.
Count them instead of trusting the screenshot: enumerate `overlayer.element` `:scope > g`
groups and filter by `width < 30 && height < 25`.

**Separate PRE-EXISTING bug found while verifying, UNFIXED, no issue filed:** rapid handle
drags occasionally leak a stale *highlight* overlay too. `applyAnnotationRange` awaits
`getAnnotationText` between reading `editingAnnotationRef.current` and the remove/add, and
`handleDragEnd`'s commit can overlap the last in-flight drag apply. Reproduced on the
unmodified baseline (groups +1 with bubbles unchanged), so it is not caused by the #5538 fix.
Also unfixed and adjacent: `editingAnnotationRef = useRef(annotation)` never re-syncs, and
`onShowAnnotation` batches `setEditingAnnotation(null)` then `setEditingAnnotation(next)` in
one handler so `AnnotationRangeEditor` does not remount — tapping straight from highlight A
to highlight B can edit A's record.

See [[browser-verify-readest-web-recipe]] for how the drag was driven from Chrome.
Related: [[annotator-reader-fixes]].
