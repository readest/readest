---
name: feedback-always-verify-on-xiaomi
description: Standing instruction - verify every device-relevant change on the Xiaomi 13 before handing back
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f961c9a5-5e6e-4e95-8794-0dcc2a97212a
  modified: 2026-11-12T15:08:17.738Z
---

Always verify device-relevant changes (player, audio, media session, Android behavior) on the Xiaomi 13 (adb device 368b0948, model 2211133C) before reporting done, not just unit tests.

**Why:** Unit-green changes repeatedly broke on the real device during the Audiobookshelf work (CSP media-src block, cleartext policy, boot-hydration wipe, spurious pause after start) — every one was invisible to the suite and found only on the phone.

**How to apply:** Build+install with `pnpm dev-android` (release APK, aarch64). Drive verification via CDP: socket `adb shell cat /proc/net/unix | grep webview_devtools_remote`, `adb forward tcp:9223 localabstract:<sock>`, then a Runtime.evaluate driver (node + native WebSocket). `readest://book/<hash>` deep link opens books reliably, bypassing [[issue-4584-tap-death-investigation]] (adb input taps die intermittently). ABS book hashes are deterministic: `md5('abs://' + md5('abs:<serverUrl>') + '/<itemId>')`. Dev ABS instance: the dev ABS login (in [[private-feedback-always-verify-on-xiaomi]], local only). The user's finger is needed only when tap-death eats injected taps AND no deep link fits; audio playing is verifiable via advancing player position + `dumpsys media_session` PLAYING state + ABS server /api/me progress advancing. TOUCH GESTURES too: CDP `Input.dispatchTouchEvent` synthesizes taps, drags (pull-to-bookmark), and two-finger pinches reliably (they enter the real input pipeline, reach iframe capture-phase listeners with correct screenX/Y, and are immune to tap-death); mid-gesture DOM state is assertable by Runtime.evaluate between the move and the release — used for the #5142/#5757 bookmark-pull verification (see [[bookmark-pull-fixed-layout-5142]]).


**CDP hangs while the phone is locked (2026-11-12):** the devtools socket accepts but `/json` never answers while the Xiaomi sits on the AOD lock screen. `adb shell input keyevent KEYCODE_WAKEUP` + `input swipe 540 2000 540 600 250` unlocks it (no PIN), then CDP answers.

**CDP touch coordinates are CSS px, not screenshot px (2026-11-12):** screencap is 1080x2400 device px; the WebView is 392x872 CSS px (dpr ~2.75). A tap aimed from a downscaled screenshot (sips -Z 1000) landed in the View menu's Sort list and switched the owner's library sort to Author (restored). Scale screenshots exactly with `sips -z 872 392`, and find menu items from the DOM (`getBoundingClientRect` + `elementFromPoint` hit test) before tapping. Close menus with their own toggle button first; a drag started while a menu is open goes into the menu.

**Keep the Xiaomi on the newest build (owner, 2026-11-11):** "always keep the apk on Xiaomi the latest version, either from main or from the latest fix worktree". The owner tests on the phone between turns. When a PR merges, rebuild from main (or merge main into the active fix worktree) and reinstall; never leave the phone on a branch that predates a merged fix. Say which commit the phone runs in every report.
**Why:** on 2026-11-11 the phone ran the #7465 build, branched before #7463 merged, so the owner retested the curl blur on a build without the curl fix and saw it unfixed.

**E-ink verification device:** a Boox **Leaf5** (adb `ec8fafd`, model/product `Leaf5`) is available on USB for `[data-eink]` work, alongside the Xiaomi. Same `pnpm dev-android` flow; it arrives `unauthorized` after a reconnect, so the USB-debugging prompt has to be accepted on the panel before the chained `adb install -r` can land. Used for [[reading-ruler-eink-6048]].

## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [Always verify on Xiaomi](feedback-always-verify-on-xiaomi.md) device 368b0948 (VPN'd); CDP+deep-link recipe; md5-check the device APK (dev builds report 0.12.1); suites alone repeatedly missed device bugs
