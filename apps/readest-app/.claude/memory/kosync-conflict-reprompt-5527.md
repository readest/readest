---
name: kosync-conflict-reprompt-5527
description: "#5527 KOSync conflict dialog reappeared on every window re-activation (Android dictionary popup); fix = resolved-report memory + same-device percentage compare"
metadata: 
  node_type: memory
  type: project
  originSessionId: b992283a-a0ee-4723-acf9-a9162881b114
  modified: 2026-08-06T03:15:51.905Z
---

Issue #5527: on Android, closing a system dictionary popup (DictTango) re-showed the KOSync conflict dialog every time, even after the user had just resolved it. MERGED PR #5528 (2026-08-06); worktree and branch cleaned up. Device verify on Android with a real KOSync server pending.

Root cause (two holes in `useKOSync.ts`):
1. `useWindowActiveChanged` re-pulls on every visibility regain with NO memory that the user just resolved a conflict; if the pull returns the same unchanged remote report (resolve-time push raced or failed), the identical conflict re-prompts.
2. Same-device echo reports went through the XPointer -> CFI -> fraction round-trip, where an 'unresolved' failure unconditionally forces the prompt (the #5065 rule, meant to protect OTHER devices' positions). Our own pushed XPointer can also get mis-anchored: `getCFIFromXPointer` feeds the report's percentage into `resolveSpineSectionIndex` as a CREngine drift anchor, but our percentage is foliate locations-based, so near section boundaries it can re-anchor to the wrong section.

Fix: (a) `resolvedRemoteRef` remembers progress+timestamp+device_id of the report settled via the dialog; a pull returning the identical report goes straight to 'synced'. (b) `isSameDevice` reports compare `remote.percentage` against local percentage directly (same formula on both sides), skipping resolution entirely.

Key invariants: the #5065 unresolved-means-conflict rule still applies to other-device reports; a remote report that CHANGED since resolution still prompts (new genuine conflict). `FoliateViewer.tsx` wires `onClose` of the dialog to `resolveWithLocal`, so any dismissal records the resolution too.

Related: [[epub-encoded-href-reserved-chars-5097]] for xcfi context, #5065/#5109/#3166 history in useKOSync.
