---
name: feedback-always-verify-on-xiaomi
description: Standing instruction - verify every device-relevant change on the Xiaomi 13 before handing back
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f961c9a5-5e6e-4e95-8794-0dcc2a97212a
  modified: 2026-08-19T17:22:57.727Z
---

Always verify device-relevant changes (player, audio, media session, Android behavior) on the Xiaomi 13 (adb device 368b0948, model 2211133C) before reporting done, not just unit tests.

**Why:** Unit-green changes repeatedly broke on the real device during the Audiobookshelf work (CSP media-src block, cleartext policy, boot-hydration wipe, spurious pause after start) — every one was invisible to the suite and found only on the phone.

**How to apply:** Build+install with `pnpm dev-android` (release APK, aarch64). Drive verification via CDP: socket `adb shell cat /proc/net/unix | grep webview_devtools_remote`, `adb forward tcp:9223 localabstract:<sock>`, then a Runtime.evaluate driver (node + native WebSocket). `readest://book/<hash>` deep link opens books reliably, bypassing [[issue-4584-tap-death-investigation]] (adb input taps die intermittently). ABS book hashes are deterministic: `md5('abs://' + md5('abs:<serverUrl>') + '/<itemId>')`. Dev ABS instance: http://192.168.2.3:13378 (readest/readest123). The user's finger is needed only when tap-death eats injected taps AND no deep link fits; audio playing is verifiable via advancing player position + `dumpsys media_session` PLAYING state + ABS server /api/me progress advancing. TOUCH GESTURES too: CDP `Input.dispatchTouchEvent` synthesizes taps, drags (pull-to-bookmark), and two-finger pinches reliably (they enter the real input pipeline, reach iframe capture-phase listeners with correct screenX/Y, and are immune to tap-death); mid-gesture DOM state is assertable by Runtime.evaluate between the move and the release — used for the #5142/#5757 bookmark-pull verification (see [[bookmark-pull-fixed-layout-5142]]).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [Always verify on Xiaomi](feedback-always-verify-on-xiaomi.md) device 368b0948 (VPN'd); CDP+deep-link recipe; md5-check the device APK (dev builds report 0.12.1); suites alone repeatedly missed device bugs
