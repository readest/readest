---
name: curl-toolbar-flash-invalidate-cover
description: Curl/Flip chrome flashes MERGED #7343 UNRELEASED; native invalidate lifted the cover, stale textures held old panels; final build + iOS not device-checked; CDP IPC hook recipe
metadata:
  type: project
---

2026-11-06, MERGED #7343 as 849be95dc (head 9b026f482), UNRELEASED, worktree removed. Curl/Flip symptoms: swipe with toolbars up flashed a neighbouring page ~50 ms and lost the turn; center taps flashed about 1 in 3; bottom tabs flashed the old panel 2-3 frames.

Causes: native `invalidate` sets alpha 0 and deletes the cover texture while `previewPage` has the live page parked on a neighbour, and `start` then fails on the missing texture. Native sheets span the whole cell, so they hold toolbars and panels; a kept texture was re-raised by the warm-up 360 ms later.

Fix: `NativePageTurn` holds `invalidate` until warm-up, scene and rollback end, ignores native's reported keys while held, and clears `#keys` on release. Any reader chrome change now drops native pages. A started scene is no longer restored on empty keys.

**Unverified:** Xiaomi device runs covered 8b740347a only (swipes, taps). Panel fix, held slower swipe and final head were not re-run on a device; iOS and Always Show Status Bar never run.

**Open:** `FoliateViewer.tsx:935` `setTimeout(() => setLoading(true), 200)` is uncleared; it fired after teardown and failed CI once (`window is not defined`). Native `cancel` also lifts the cover mid-preview; very small window.

**Recipe:** on Android release+devtools builds, `__TAURI_INTERNALS__.invoke` is non-writable; wrap `window.ipc.postMessage` over CDP (Node 24 built-in WebSocket; unset proxy env) to log `paper_curl` ops. Toybox `pkill -2 screenrecord` signals far more than its name; use `--time-limit`. Page keys: `foliate-view.renderer.getPageTurnKey(0)`. Full-frame A->B->A pairs in a frame diff = flash; a single spike = the curl's first pose.

Related: [[native-curl-capture-timing-2026-10-25]], [[feedback-pin-adb-serial]], [[feedback-toolbars-never-change-layout]].
