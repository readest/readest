---
name: native-cover-above-ime-7171
description: "#7171 keyboard dead in reader settings with Curl/Page Flip: not-focusable PopupWindow sits above the IME, untrusted-touch drop; MERGED #7191 UNRELEASED; Xiaomi install/instrument gotchas"
metadata:
  node_type: memory
  type: project
  originSessionId: a54f4147-4ada-47c3-aeb5-3ab334db3d57
  modified: 2026-10-31T18:58:12.273Z
---

#7171 (2026-11-01): with Curl or Page Flip on Android, the keyboard ignored every key in
the in-book settings. Cause: the native page cover (`NativePaperTurn` PopupWindow, and the
turn-time page cover in `NativeBridgePlugin`) is not focusable, so Android stacks it ABOVE
the InputMethod window. The keyboard is a different UID, so InputDispatcher logs
"Dropping untrusted touch event due to com.bilingify.readest ... PopupWindow".
Fix: `inputMethodMode = INPUT_METHOD_NEEDED` + `softInputMode = SOFT_INPUT_ADJUST_NOTHING`.
MERGED #7191 as 1166393eb (2026-10-31, UNRELEASED); worktree removed; verified in the real app on the Xiaomi under both styles.

**Why:** any new app-owned overlay window (PopupWindow / sub-panel) that is not focusable
will cover the IME and kill typing; check `dumpsys window windows` ordering.

**How to apply (Xiaomi gotchas):**
- MIUI shows "Install via USB" for every `adb install`, ~10 s countdown, and refuses
  injected taps on it (INSTALL_FAILED_USER_RESTRICTED). Ask the user to tap Install.
- No emulator system images are installed on this Mac (AVDs exist, images missing).
- Instrumented test activity won't launch on MIUI ("Could not launch intent ... 45000 ms")
  until `adb shell appops set com.readest.native_bridge.test 10021 allow`; then
  `am instrument -w -e class <Class#method> com.readest.native_bridge.test/androidx.test.runner.AndroidJUnitRunner`.
  Uninstall the test APK afterwards.
- Reader settings over CDP: tap center for toolbar, button aria-label "Font & Layout",
  then "More Settings"; tabs at y=338 (Font, Layout, Theme, Behavior, ..., Custom).
  Don't tap blind coordinates in the bottom panel: a stray tap hit the progress slider and
  moved the user's book; "Go Back" restored it.

Related: [[feedback-always-verify-on-xiaomi]], [[native-curl-capture-timing-2026-10-25]].
