---
name: issue-4584-tap-death-investigation
description: "#4584 single-taps-dead-after-picture-zoom: isPopuped self-heals (red herring), likely WebView-148-specific, plus Android emulator/CDP gesture-verification gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: a41b6cab-c0f3-4740-a4c0-61a10b68fc09
---

#4584 (Android): after using picture zoom (long-press image → ImageViewer → close),
single taps stop registering until app restart while long-press keeps working. OP on
Android 16 / WebView 148. **NOT root-caused / NOT fixed.** PR #4600 only adds single-tap
as a second way into the viewer (see [[tap-to-open-image-table-4600]]); it does not fix
the tap-death.

**Red herring — don't "fix" `isPopuped`.** An adversarial analysis pointed at
`useTextSelector.ts` `handleSingleClick`'s `isPopuped` branch consuming a tap without
resetting the flag (unlike its `isTextSelected`/`isUpToPopup` siblings). But it
**self-heals**: the branch calls `handleDismissPopup()` → `showingPopup` false →
`handleShowPopup(false)` → `isPopuped` false after 500ms. And the uncancelled 500ms
timer in `handleShowPopup` always converges `isPopuped` to the FINAL `showingPopup`
(timers are same-delay FIFO), so it can't strand `isPopuped=true` with `showingPopup=false`.
Net effect is at most a one-tap glitch, NOT permanent. Resetting it in the branch is
harmless but does NOT explain #4584.

Likely **WebView-148-specific**: the OP reproduces; the maintainer's Xiaomi and the
Pixel_9_Pro emulator (WebView **133**) do NOT. A stronger unverified permanent-death
candidate is `isInstantAnnotating`/`scrollLocked` getting stuck when the ImageViewer
overlay swallows the `pointerup` (needs instant-annotation enabled).

**Android emulator gesture-verification gotchas (this machine):**
- Host-GPU `Pixel_9_Pro` AVD CRASHES on rapid pinch (Vulkan `bad_function_call`); a
  re-launch can hang at Vulkan init. `-gpu swiftshader_indirect` boots reliably but is
  too slow for the WebView reader → repeated "Input dispatching timed out for
  FocusEvent" ANRs under automation. **That ANR is an EMULATOR ARTIFACT, not app code**
  (JS stays responsive; CPU runs native arm64 on Apple Silicon, only the GPU is
  swiftshader; CPU profile of page-turns is light; full-screen backdrop-blur made zero
  frame-time difference).
- CDP `Input.dispatchTouchEvent` CANNOT trigger the WebView's native text-SELECTION
  gesture, so the annotation popup never appears (blocks reproducing selection-driven
  bugs). It also leaves `screenX=0`, so `handlePageFlip` treats every synthetic tap as
  left/`prev()` (no-op at page 1 → navigate mid-book to test page-turns via relocate).
- Native `adb shell input tap` does NOT reach the WebView's click pipeline.
- Long-press via CDP only works if you HOLD the touch on one open connection and poll
  (a touchStart→sleep→touchEnd across separate `node` invocations releases too early).
- Drive the live on-device WebView: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`
  + a `ws` CDP client; the debug APK exposes the socket. VIEW-intent a pushed EPUB via its
  MediaStore `content://.../<id>` to import it.
