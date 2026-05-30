---
name: kosync-cfi-spine-resolution
description: "KOSync CFI↔XPointer conversion must resolve via the CFI's own spine index, not the paginator's primaryIndex (which lags during scroll)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41b15d60-969d-4173-9db7-d1515721e527
---

KOSync progress push/pull converts between foliate CFI and KOReader XPointer via `src/utils/xcfi.ts`. `XCFI` is constructed for ONE spine section (`spineItemIndex`) and `cfiToXPointer`/`xPointerToCFI` throw `CFI spine index N does not match converter spine index M` if asked to convert a CFI from a different section.

**Pitfall:** `view.renderer.primaryIndex` lags behind the viewport during scrolling (see `paginator.js` `#primaryIndex` comment). So `progress.location` can be a CFI in a different spine section than the currently-rendered primary view. Building the converter from the primary view's `doc`/`index` then converting `progress.location` throws on mismatch.

**Fix (PR branch fix/kosync-spine-index):** always go through the exported helpers `getXPointerFromCFI(cfi, doc?, index?, bookDoc)` / `getCFIFromXPointer(...)` in `xcfi.ts`. They call `XCFI.extractSpineIndex(cfi)` and, when the passed `index` ≠ the CFI's spine, load the correct section's document via `bookDoc.sections[xSpineIndex].createDocument()`. `generateKOProgress` in `src/app/reader/hooks/useKOSync.ts` had hand-rolled `new XCFI(primaryDoc, primaryIndex)` instead of using the helper — that was the bug.

**Why:** the helper already handles cross-section resolution correctly; never reconstruct the converter inline against `primaryIndex`.

**How to apply:** for any CFI→XPointer or XPointer→CFI in KOSync code, use the `getXPointerFromCFI`/`getCFIFromXPointer` helpers and pass `bookDoc` so off-screen sections can be loaded. Related: [[issue-4112-scroll-anchoring]] (same primaryIndex/scroll-lag family). The companion foliate `fromRange` crash (`Cannot destructure property 'nodeType'`) during relocate is separate scroll-lag noise, not the sync blocker.

**Conflict-detection comparison (`promptedSync` in `useKOSync.ts`):** KOReader's reported `remote.percentage` comes from CREngine pagination and is NOT comparable to Readest's progress. For reflowable books, convert the remote XPointer → local CFI → `view.getCFIProgress(cfi).fraction` (helper `getRemoteLocalFraction` in `kosyncProgress.ts`) and compare THAT to the local percentage; fall back to `remote.percentage` only when it can't be resolved locally (non-XPointer/Kavita progress or missing section). The resolved fraction also drives the "Approximately X%" remote preview so the dialog shows what was actually compared. Fixed-layout still compares page-derived `remotePercentage`. Threshold: `0.0001` cross-device, but loosened to `0.01` when `remote.device_id === settings.kosync.deviceId` (same device = our own earlier push; don't prompt on sub-page drift). Percentages render via `formatProgressPercentage` (2 decimals, `kosyncPreview.ts`).
