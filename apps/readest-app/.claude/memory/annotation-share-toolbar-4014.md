---
name: annotation-share-toolbar-4014
description: "Share intent in the selection toolbar + drag-and-drop toolbar customizer (#4014)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 507a0166-cb55-4f33-b633-3230c0c514ff
---

#4014 (PR #4570) — added a native "Share" tool to the in-reader text-selection toolbar
plus a drag-and-drop customizer (show/hide + reorder tools). Branch
`feat/annotation-share-toolbar-4014`; spec + plan in
`docs/superpowers/{specs,plans}/2026-06-13-annotation-share-toolbar*`.

Key facts / gotchas:
- **`src/utils/share.ts` is dual-purpose** — it already held share-LINK helpers
  (`buildShareUrl`/`parseShareDeepLink` for the `/s/{token}` feature). Text-share was
  added there: `shareSelectedText(text, position?, appService?)` and
  `canShareText(appService)`.
- **Native share is gated to mobile + macOS only** (`isMobileApp || isMacOSApp`).
  Windows/Linux desktop are excluded because `@choochmeque/tauri-plugin-sharekit-api`'s
  share UI can FREEZE the app on Windows (issue #4343) — `nativeAppService.saveFile`
  gates `shareFile` the same way. Ladder: native → `navigator.share` → clipboard.
  `canShareText` = that OR web `navigator.share`; used to gate Share's visibility in
  toolbar + customizer + the quick-action dropdown.
- **Toolbar order is a view setting**: `AnnotatorConfig.annotationToolbarItems`
  (`src/types/book.ts`), default in `DEFAULT_ANNOTATOR_CONFIG` = the original 8 tools,
  **Share hidden by default** (starts in the "Available" tray). No migration needed:
  the `{...getDefaultViewSettings(ctx), ...saved}` merge in `settingsService.ts` +
  `getToolbarToolTypes(undefined,...)` fallback both yield the default.
- **Pure helpers** in `src/utils/annotationToolbar.ts` (unit-tested) own all
  order/visibility logic: `getToolbarToolTypes`/`getAvailableToolTypes` (canShare-gated,
  dedup, drop-unknown), `add/remove/reorderToolbar`. `ALL_ANNOTATION_TOOL_TYPES` is
  asserted to match the `annotationToolButtons` registry order by a test.
- **Customizer** = `src/components/settings/AnnotationToolbarCustomizer.tsx`, a sub-page
  off `ControlPanel` (Behavior panel) via `NavigationRow`. Two `@dnd-kit` zones; chips are
  tap-to-toggle AND drag. Design evolved heavily during live browser testing (see gotchas):
  - **WYSIWYG**: "In toolbar" renders a faithful preview of the real selection popup —
    `selection-popup bg-gray-600 text-white`, icon-only 32×32 buttons (mirrors
    `AnnotationToolButton`), `w-fit max-w-full` (content-width, start-aligned). "Available"
    tools are labeled icon+text chips. Zone content uses `px-4` to align with `SubPageHeader`.
  - **dnd-kit multiple-containers pattern** (NOT the simple single-list one): single
    `{toolbar, available}` state; `onDragOver` live-reparents across zones; custom
    `collisionDetection` = `pointerWithin` → `rectIntersection` fallback, snapping a zone-id
    hit to the closest inner chip (plain `closestCorners`/`closestCenter` CANNOT drop into an
    empty zone). `rectSortingStrategy` (NOT `horizontalListSortingStrategy`, which breaks
    wrapped layouts).
  - **NO `DragOverlay`** — the settings modal is a CSS-`transform` container, so a
    `position:fixed` overlay is offset from the cursor. In-place `useSortable` transform
    (relative translate) tracks correctly.
  - **`itemsRef` stale-closure fix**: dnd-kit calls `onDragEnd` with the handler captured at
    drag START, so the closed-over `items` is stale → a cross-zone drag would bounce back on
    release. Read live state from `itemsRef.current` in `handleDragEnd`/tap handlers.
  - **Add all** (rebuilds in canonical `ALL_ANNOTATION_TOOL_TYPES` order, NOT prior order) /
    **Clear all** header buttons.
  - Cross-platform guard: when editing on a `!canShare` device, `persist` re-appends a
    `share` that was synced-in but hidden, so it isn't dropped for share-capable devices.
- **Empty toolbar suppresses the popup**: when `getToolbarToolTypes` yields [] (user cleared
  all), `Annotator.tsx` does NOT render the `AnnotationPopup` on a plain selection (gated on
  `toolButtons.length > 0 || highlightOptionsVisible || annotationNotes.length > 0`) — no
  empty bar, but highlight-edit/notes popups still work. (Earlier tried fallback-to-default;
  user wanted full suppression instead.)
- Adding a tool to the union (`AnnotationToolType`) is compile-checked: the
  `createAnnotationToolButtons` generic in `AnnotationTools.tsx` requires every member.
