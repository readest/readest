---
name: ios-native-paper-curl-7046
description: "iOS native paper curl (port of Android #7001) MERGED #7046 c811741af 2026-10-24; sim-only verified; device, real finger tracking, RTL, CBZ untested; Android reload-mid-turn gap open"
metadata:
  node_type: memory
  type: project
  originSessionId: 9811963f-e380-4500-ae63-09110742d557
  modified: 2026-10-24T06:55:11.937Z
---

iOS got the native Metal paper curl in #7046 (merged c811741af, 2026-10-24, UNRELEASED at merge), a Swift twin of Android's #7001 (NativePaperMesh.swift, NativePaperTurn.swift in tauri-plugin-native-bridge/ios).

Verified only on the iPhone 17 Pro simulator (iOS 26.3) via iwdp ([[ios-sim-webview-drive-via-iwdp]]). NOT verified: a physical device, native finger tracking (sim synthetic touches never reach UIKit, drags went through the JS move path), RTL books, CBZ.

**Why:** watch for regressions on real devices after release; these gaps are where they'd show.

**How to apply:**
- A report of a stuck/frozen curl on iOS: check whether `takeSnapshot` stopped completing (seen once in the sim after a failed openurl import + reload, cleared on relaunch; the 3 s deadline fails the turn instead of hanging).
- The native scene outlives a page load. #7046 seeds NativePageTurn owners randomly per page load (also fixes Android) and resets the iOS scene on WebContent termination and main-frame didCommit.
- Android still only disposes on activity onDestroy, so a JS-only reload during a held turn could leave the sheet stuck there. Not filed yet.
- Known: a pre-captured page's footer page number can be stale inside the curling sheet (shared JS capture, both platforms).
- MTKTextureLoader can't decode WKWebView snapshot CGImages ("Image decoding failed"); redraw as BGRA8 via CGContext.

Related: [[two-column-spine-curl-6107]], [[fixed-layout-page-curl-6239]].
