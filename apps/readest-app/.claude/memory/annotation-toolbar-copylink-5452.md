---
name: annotation-toolbar-copylink-5452
description: Copy Link in the reader selection toolbar is opt-in purely via ALL_ vs DEFAULT_ tool lists; it resolves the note at the selection CFI
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fe0d4e7-c41d-496e-a9ca-e3976830677e
  modified: 2026-08-03T13:42:13.175Z
---

#5452 asked for the sidebar's per-note Copy (#5441) to be reachable from the reader's own selection toolbar. MERGED #5464 (a5da929) as a `copylink` tool that copies the bare annotation URL.

Opt-in is entirely the two lists in `src/utils/annotationToolbar.ts`: a type in `ALL_ANNOTATION_TOOL_TYPES` but NOT in `DEFAULT_ANNOTATION_TOOLBAR_ITEMS` never renders in the popup, while `getAvailableToolTypes` (canonical-order complement of the visible list) surfaces it in the Customize Toolbar "Available" tray for default AND already-customized users. `share` uses the same trick (#4014). No extra flag or gating code is needed for a new opt-in tool.

`handleCopyLink` in Annotator.tsx: cfi = `selection.cfi || view.getCFI(...)`; noteId = first non-deleted booknote at that cfi, else `uniqueId()`. Deep-link resolution (`useOpenAnnotationLink`, the `/o` landing page) navigates off the **cfi** only and the noteId merely has to be present, so a plain unhighlighted selection still yields a working position link. Link form follows `noteExportConfig.linkType` ('app' on tauri, 'web' elsewhere).

`tooltip` in the `annotationToolButtons` registry is ONLY rendered for quick actions (QuickActionMenu). Non-quick-action entries (annotate, proofread, copylink) carry dead i18n keys by existing convention.

Verified in Chrome against a real library: the toolbar's link is byte-identical (note id + cfi) to what the sidebar's own Copy emits for the same note. See [[chrome-clipboard-paste-probe]] and [[web-e2e-local-devserver-cold-compile-flake]].
