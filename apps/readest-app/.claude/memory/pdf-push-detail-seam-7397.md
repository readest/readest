---
name: pdf-push-detail-seam-7397
description: "PR #7398 / #7397 PDF push-swipe seam; Android fractional-dpr innerWidth trap, Xiaomi CDP recipe and gotchas"
metadata:
  node_type: memory
  type: project
  originSessionId: d2af3e30-773a-48d0-8334-7de68c2f1e50
  modified: 2026-11-09T13:29:21.976Z
---

PR #7398 (community, sunnymodi21) + readest/foliate-js#150: retained push turns for fixed layout.
Reworked + PUSHED 2026-11-09; main merged in 2026-11-10: foliate-js#150 MERGED as 3843187 (2026-11-10) +
readest head 57d8990ff (#7398) points at merged foliate-js#154 (267965e).

Facts found on the Xiaomi 13 (368b0948, dpr 2.75, 1080 px):
- `innerWidth` is 392 but `visualViewport.width` is 392.727. pdf.js clamped the detail canvas to
  innerWidth → 2 device-px coarse strip at the page edge; invisible at rest (integer px), a grey
  1 px line while a push moves the page fractionally. Fix: clamp to visualViewport.
- 0.12.20 bug reproduced on Android too: captured push left a 112 px detail strip after landing.
- Android native-touch touchend and DOM touchend arrive within ±1 ms (9 real swipes), so the PR's
  250 ms native-lift timer is not an Android risk. Memory after paging was lower than 0.12.20.

Recipe gotchas:
- VIEW intent of a PDF (application/pdf) IMPORTED it into the library (71→72 books); not transient.
- CDP `Input.synthesizePinchGesture` leaves a stale touch: later CDP drags keep zooming. Use the View
  menu zoom buttons; tapping the "N%" label resets to 100%.
- Isolate which layer draws a line: hide `[data-page-turn-view=outgoing|incoming]` with opacity 0
  during a held CDP drag, then scan one blank screencap row with ffmpeg crop + od.
- Worktree left mid-rebase by an interrupted `worktree:new` lacks js-mdict/tauri/qcms submodules,
  simplecc dist, vendor, android gen + keystore symlink, target symlink.

Related: [[android-e2e-local-repro-workflow]], [[pdf-detail-canvas-sharp-text-7100]], [[feedback-pin-adb-serial]]

#150 preload trap (fixed 6d40764): preloading through #render's preview path used
#pageTurnScaleFactor (capped at fit-page), so when zoomed in every tap turn re-rasterized the
preloaded page. Preload must draw at #scaleFactor. Probe: count onZoom calls per section on next().

Review fixes in foliate#154 (2026-11-11): backward preload regroup moved/split the shown spread
(skip or blank screen) -> #regroup rebases #index for intact spreads, preload defers splits;
endPageTurn bumps the spread it left (else trim evicts it); sibling overlayer at commit;
View#createOverlayer aborts the old overlayer's doc listeners.

Xiaomi verify of bcff870b0 (2026-11-11): zoom preload, page-left cached, stale overlayer
listener all PASS. Found a separate main bug: dark theme + "apply theme colors" (keepImages)
draws 1px #222 rows at the image-strip seams of the FAA scan (applyPageColors rounds kept
image rects inward); 0 rows with theme off. NOT fixed, not filed yet.
Gotcha: adb taps while the View menu is open toggle its rows (lock-pan got flipped); screenshot
before tapping and re-check menu toggles before handing the phone back.

**User report #7987 (2026-11-26) = this bug on 0.12.20:** Samsung tablet/phone, scanned PDF, a thin
vertical line after 2-4 push turns that a pan clears. Main checked on the Xiaomi with the reporter's PDF
(60 push turns, detail full-page after every landing). Archive: ~/Documents/books/issues/7987/.
Gotcha: dev-web can NOT exercise this: the finger-tracked fixed-layout push (`getCapturedTurnStyle`)
needs `isTauriAppPlatform()`, and desktop Tauri never makes a detail canvas (`isMobileWebView`).
Only a mobile app build reproduces it.
