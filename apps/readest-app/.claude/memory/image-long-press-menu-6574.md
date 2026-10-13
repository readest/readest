---
name: image-long-press-menu-6574
description: "#6574 long-press image menu on mobile; Android WebView clipboard image write is a silent no-op; Android contextmenu is scroll-safe, iOS needs a JS hold timer"
metadata:
  node_type: memory
  type: project
  originSessionId: 6e3c6542-da02-4df4-964a-326e58e57122
  modified: 2026-10-03T09:33:01.956Z
---

#6574 (2026-10-03): long-press on a book image opens the #6567 image menu on mobile.
MERGED #6601 (64337783e), UNRELEASED; worktree + branch removed. CodeRabbit share-sheet failure-vs-dismissal ask DECLINED (shared saveFile contract; plugin throws on dismiss).

- **Android**: the WebView fires `contextmenu` ~380ms into a still long-press, and it does NOT fire during a slow scroll that starts on the image (verified in Chrome on the Xiaomi). So the native event is safe from the #5069 mid-scroll trap that killed the old JS long-press timer.
- **Android clipboard**: `navigator.clipboard.write([ClipboardItem image/png])` from the Readest WebView RESOLVES but never reaches the system clipboard. Proof: paste into Chrome still returned Chrome's own earlier clip. Chrome→Chrome image paste works, so the test is valid. tauri clipboard-manager has no image support on mobile. chrox chose: Android menu = Save Image (gallery) + Share Image, no Copy. A native copy would need FileProvider + `ClipData.newUri`; the provider `${applicationId}.fileprovider` already exists.
- **iOS**: WebKit fires no `contextmenu` on long-press (documented, NOT sim-verified: computer-use was held by another session). Implemented as a 500ms (`LONG_HOLD_THRESHOLD`) pointer hold in useTextSelector, cancelled by pointerup, pointercancel, or a move over 10px. iOS on-device/sim verification PENDING.
- On touch, `isTextAtPoint` skips the menu so text (including PDF text over scans) keeps long-press selection.
- Vector PDF figures (e.g. the Feynman Lectures) have no raster images, so `getImageAt` finds nothing and no menu appears. That is correct, not a bug.

Device recipe: build a tiny EPUB (text + inline PNG), `adb push` it to /sdcard/Download, media-scan it, and open it with a VIEW intent on `content://media/external/file/<id>`. Count gallery saves with `content query --uri content://media/external/images/media --where "relative_path LIKE '%Readest%'"`.
