---
name: annotation-share-toolbar-4014
description: "Share intent in the selection toolbar + drag-and-drop toolbar customizer (#4014)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 507a0166-cb55-4f33-b633-3230c0c514ff
---

#4014 — added a native "Share" tool to the in-reader text-selection toolbar plus a
drag-and-drop customizer (show/hide + reorder tools). Branch
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
  off `ControlPanel` (Behavior panel) via `NavigationRow`, two `@dnd-kit` zones (pattern
  copied from `CustomDictionaries.tsx`). Chips are tap-to-toggle AND drag (e-ink/keyboard
  a11y, since no KeyboardSensor). Cross-platform guard: when editing on a `!canShare`
  device, `persist` re-appends a `share` that was synced-in but hidden, so it isn't
  dropped for the user's share-capable devices.
- Adding a tool to the union (`AnnotationToolType`) is compile-checked: the
  `createAnnotationToolButtons` generic in `AnnotationTools.tsx` requires every member.
